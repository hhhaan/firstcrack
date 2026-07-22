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
import { mergeStatus } from '../_shared/channels/status-map.ts';
import type { CanonicalStatus, ChannelSecrets, Platform } from '../_shared/channels/types.ts';

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
        .select('id, status, attempt_count')
        .eq('order_id', order.id)
        .maybeSingle();

    if (existingDispatch && (existingDispatch.status === 'sent' || existingDispatch.status === 'confirmed')) {
        return jsonResponse({ error: 'already dispatched', status: existingDispatch.status }, 409);
    }

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
            return jsonResponse({ error: 'Failed to create dispatch' }, 500);
        }
        dispatchId = created.id;
    }

    const { data: secretRow, error: secErr } = await admin
        .from('sales_channel_secrets')
        .select('credentials')
        .eq('connection_id', order.connection_id)
        .single();
    if (secErr || !secretRow) {
        await admin
            .from('order_dispatches')
            .update({ status: 'failed', last_error: 'secrets not found', updated_at: now })
            .eq('id', dispatchId);
        return jsonResponse({ error: 'channel secrets not found' }, 400);
    }

    let secrets = secretRow.credentials as ChannelSecrets;
    const platform = order.platform as Platform;
    const adapter = getAdapter(platform);

    if (!adapter.capabilities.outboundDispatch) {
        return jsonResponse({ error: 'platform does not support outbound dispatch' }, 400);
    }

    const refreshed = await adapter.refreshAuth(secrets);
    if (refreshed) {
        secrets = { ...secrets, ...refreshed };
        await admin
            .from('sales_channel_secrets')
            .update({ credentials: secrets, updated_at: now })
            .eq('connection_id', order.connection_id);
    }

    const lines = ((order.order_lines ?? []) as Array<{ platform_line_id: string; status: string }>)
        .filter((l) => l.status === 'active')
        .map((l) => ({ platformLineId: l.platform_line_id }));

    if (!lines.length) {
        await admin
            .from('order_dispatches')
            .update({ status: 'failed', last_error: 'no active lines', updated_at: now })
            .eq('id', dispatchId);
        return jsonResponse({ error: 'no active order lines' }, 400);
    }

    const carrierCode = platformCarrierCode(body.carrier, platform);
    const result = await adapter.markShipped(secrets, {
        platformOrderId: order.platform_order_id,
        lines,
        carrierCode,
        trackingNumber: tracking,
    });

    if (result.ok || result.alreadyShipped) {
        const event = result.alreadyShipped ? 'api_already_shipped' : 'api_ok';
        const status = nextDispatchStatus('pending', event);
        const shippedStatus = mergeStatus(order.status as CanonicalStatus, 'shipped');
        await admin
            .from('order_dispatches')
            .update({
                status,
                sent_at: now,
                line_results: result.lineResults ?? null,
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
        const { data: conn } = await admin
            .from('sales_channels')
            .select('auto_fulfill_on_shipped')
            .eq('id', order.connection_id)
            .maybeSingle();
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

        return jsonResponse({
            status,
            alreadyShipped: result.alreadyShipped,
            lineResults: result.lineResults,
            fulfilled,
            fulfillError,
        });
    }

    await admin
        .from('order_dispatches')
        .update({
            status: nextDispatchStatus('pending', 'api_err'),
            last_error: (result.error ?? 'dispatch failed').slice(0, 1000),
            line_results: result.lineResults ?? null,
            updated_at: now,
        })
        .eq('id', dispatchId);

    return jsonResponse(
        {
            status: 'failed',
            error: result.error,
            lineResults: result.lineResults,
        },
        502,
    );
});
