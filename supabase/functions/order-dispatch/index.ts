/**
 * POST /order-dispatch
 * Body: { orderId, carrier, trackingNumber }
 * Outbound mark-shipped against the platform sales channel.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { isCarrierId, platformCarrierCode } from '../_shared/channels/carriers.ts';
import { shouldAutoFulfillOnDispatch } from '../_shared/channels/auto-fulfill.ts';
import { nextDispatchStatus, validateTrackingNumber } from '../_shared/channels/dispatch.ts';
import {
    acquireDispatchRunLock,
    releaseRunLock,
    type ReleaseRunLockOutcome,
} from '../_shared/channels/run-lock.ts';
import { loadSecretsSession, type SecretsSession } from '../_shared/channels/secrets-session.ts';
import { mergeStatus } from '../_shared/channels/status-map.ts';
import type { CanonicalStatus, Platform } from '../_shared/channels/types.ts';

function serviceClient() {
    return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: { orderId?: string; carrier?: string; trackingNumber?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (!body.orderId || !body.carrier || body.trackingNumber == null) {
        return jsonResponse({ error: 'orderId, carrier, trackingNumber required' }, 400);
    }
    if (!isCarrierId(body.carrier)) {
        return jsonResponse({ error: 'unknown carrier' }, 400);
    }

    let tracking: string;
    try {
        tracking = validateTrackingNumber(body.trackingNumber);
    } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'invalid tracking' }, 400);
    }

    const admin = serviceClient();
    const { data: order, error: orderErr } = await admin
        .from('orders')
        .select(
            'id, user_id, platform, platform_order_id, connection_id, status, fulfilled_at, order_lines(id, platform_line_id, status)',
        )
        .eq('id', body.orderId)
        .maybeSingle();

    if (orderErr || !order) return jsonResponse({ error: 'order not found' }, 404);
    // Workspace host or org member of host may dispatch; user_id on row stays host.
    if (order.user_id !== user.id) {
        const { data: org } = await admin
            .from('organizations')
            .select('id')
            .eq('owner_id', order.user_id)
            .maybeSingle();
        if (!org) return jsonResponse({ error: 'Forbidden' }, 403);
        const { data: membership } = await admin
            .from('organization_members')
            .select('user_id')
            .eq('org_id', org.id)
            .eq('user_id', user.id)
            .maybeSingle();
        if (!membership) return jsonResponse({ error: 'Forbidden' }, 403);
    }
    if (order.platform === 'manual') {
        return jsonResponse({ error: 'manual orders have no platform dispatch' }, 400);
    }
    if (!order.connection_id) {
        return jsonResponse({ error: 'order has no sales channel connection' }, 400);
    }

    const { data: existingDispatch } = await admin
        .from('order_dispatches')
        .select('id, status, attempt_count, line_results')
        .eq('order_id', order.id)
        .maybeSingle();

    if (existingDispatch && (existingDispatch.status === 'sent' || existingDispatch.status === 'confirmed')) {
        return jsonResponse({ error: 'already dispatched', status: existingDispatch.status }, 409);
    }

    // Same partial unique index as order-sync (status='running' AND trigger <> 'webhook').
    // Held across refreshAuth / rotate so cron sync cannot mint a Cafe24 token at the same time.
    const lock = await acquireDispatchRunLock(admin, {
        connectionId: order.connection_id,
        userId: order.user_id,
    });
    if (!lock.ok) {
        if (lock.conflict) return jsonResponse({ error: 'another run in progress' }, 409);
        return jsonResponse({ error: lock.error ?? 'Failed to acquire run lock' }, 500);
    }

    let outcome: ReleaseRunLockOutcome = { status: 'error', errorMessage: 'dispatch aborted' };
    try {
        const now = new Date().toISOString();
        let dispatchId: string;

        if (existingDispatch) {
            const { error } = await admin
                .from('order_dispatches')
                .update({
                    carrier: body.carrier,
                    tracking_number: tracking,
                    status: nextDispatchStatus(existingDispatch.status as 'pending' | 'failed', 'retry'),
                    attempt_count: (existingDispatch.attempt_count ?? 0) + 1,
                    last_error: null,
                    updated_at: now,
                })
                .eq('id', existingDispatch.id);
            if (error) {
                console.error('[order-dispatch] update row', error);
                outcome = { status: 'error', errorMessage: 'Failed to prepare dispatch' };
                return jsonResponse({ error: 'Failed to prepare dispatch' }, 500);
            }
            dispatchId = existingDispatch.id;
        } else {
            const { data: created, error } = await admin
                .from('order_dispatches')
                .insert({
                    user_id: order.user_id,
                    created_by: user.id,
                    order_id: order.id,
                    connection_id: order.connection_id,
                    carrier: body.carrier,
                    tracking_number: tracking,
                    status: 'pending',
                    attempt_count: 1,
                })
                .select('id')
                .single();
            if (error || !created) {
                console.error('[order-dispatch] insert', error);
                outcome = { status: 'error', errorMessage: 'Failed to create dispatch' };
                return jsonResponse({ error: 'Failed to create dispatch' }, 500);
            }
            dispatchId = created.id;
        }

        let session: SecretsSession;
        try {
            session = await loadSecretsSession(admin, order.connection_id);
        } catch {
            await admin
                .from('order_dispatches')
                .update({ status: 'failed', last_error: 'secrets not found', updated_at: now })
                .eq('id', dispatchId);
            outcome = { status: 'error', errorMessage: 'secrets not found' };
            return jsonResponse({ error: 'channel secrets not found' }, 400);
        }

        const platform = order.platform as Platform;
        const adapter = getAdapter(platform);

        if (!adapter.capabilities.outboundDispatch) {
            outcome = { status: 'error', errorMessage: 'platform does not support outbound dispatch' };
            return jsonResponse({ error: 'platform does not support outbound dispatch' }, 400);
        }

        const refreshed = await adapter.refreshAuth(session.current());
        if (refreshed) await session.rotate(refreshed);

        const lines = ((order.order_lines ?? []) as Array<{ platform_line_id: string; status: string }>)
            .filter((l) => l.status === 'active')
            .map((l) => ({ platformLineId: l.platform_line_id }));

        if (!lines.length) {
            await admin
                .from('order_dispatches')
                .update({ status: 'failed', last_error: 'no active lines', updated_at: now })
                .eq('id', dispatchId);
            outcome = { status: 'error', errorMessage: 'no active lines' };
            return jsonResponse({ error: 'no active order lines' }, 400);
        }

        // A previous attempt may have dispatched only part of the order (Naver returns successes and
        // failures in the same 200). Re-sending a line the platform already shipped never lands in the
        // success list again, so without this filter the order could never be completed — or fulfilled.
        const priorOk = new Set(
            ((existingDispatch?.line_results ?? []) as Array<{ platformLineId?: string; ok?: boolean }>)
                .filter((r) => r.ok === true)
                .map((r) => String(r.platformLineId)),
        );
        const retryLines = lines.filter((l) => !priorOk.has(l.platformLineId));
        const linesToSend = retryLines.length ? retryLines : lines;
        const carriedResults = retryLines.length
            ? [...priorOk].map((platformLineId) => ({ platformLineId, ok: true }))
            : [];

        const carrierCode = platformCarrierCode(body.carrier, platform);
        const result = await adapter.markShipped(
            session.current(),
            {
                platformOrderId: order.platform_order_id,
                lines: linesToSend,
                carrierCode,
                trackingNumber: tracking,
            },
            session.rotate,
        );
        const lineResults = [...carriedResults, ...(result.lineResults ?? [])];

        if (result.ok || result.alreadyShipped) {
            const event = result.alreadyShipped ? 'api_already_shipped' : 'api_ok';
            const status = nextDispatchStatus('pending', event);
            const shippedStatus = mergeStatus(order.status as CanonicalStatus, 'shipped');
            await admin
                .from('order_dispatches')
                .update({
                    status,
                    sent_at: now,
                    line_results: lineResults.length ? lineResults : null,
                    last_error: null,
                    updated_at: now,
                })
                .eq('id', dispatchId);
            await admin
                .from('orders')
                .update({
                    status: shippedStatus,
                    synced_at: now,
                    updated_at: now,
                })
                .eq('id', order.id);

            // C3: app dispatch pre-sets shipped — auto-fulfill must run here (inbound path never fires).
            let fulfilled = false;
            let fulfillError: string | null = null;
            const { data: conn, error: connErr } = await admin
                .from('sales_channel_connections')
                .select('auto_fulfill_on_shipped')
                .eq('id', order.connection_id)
                .maybeSingle();
            if (connErr) console.error('[order-dispatch] connection lookup', connErr);
            if (
                shouldAutoFulfillOnDispatch({
                    fulfilledAt: order.fulfilled_at,
                    autoFulfillOnShipped: conn?.auto_fulfill_on_shipped,
                })
            ) {
                const { error: fulfillErr } = await admin.rpc('fulfill_order', { p_order_id: order.id });
                if (fulfillErr) {
                    fulfillError = fulfillErr.message;
                    console.error('[order-dispatch] fulfill_order', fulfillErr);
                    await admin
                        .from('order_dispatches')
                        .update({
                            last_error: `fulfill: ${fulfillErr.message}`.slice(0, 1000),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', dispatchId);
                } else {
                    fulfilled = true;
                }
            }

            outcome = { status: 'success' };
            return jsonResponse({
                status,
                alreadyShipped: result.alreadyShipped,
                lineResults,
                fulfilled,
                fulfillError,
            });
        }

        const failMsg = result.error ?? 'dispatch failed';
        await admin
            .from('order_dispatches')
            .update({
                status: nextDispatchStatus('pending', 'api_err'),
                last_error: failMsg.slice(0, 1000),
                line_results: lineResults.length ? lineResults : null,
                updated_at: now,
            })
            .eq('id', dispatchId);

        outcome = { status: 'error', errorMessage: failMsg };
        return jsonResponse(
            {
                status: 'failed',
                error: result.error,
                lineResults,
            },
            502,
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[order-dispatch]', msg);
        outcome = { status: 'error', errorMessage: msg };
        return jsonResponse({ error: msg }, 500);
    } finally {
        await releaseRunLock(admin, lock.runId, outcome);
    }
});
