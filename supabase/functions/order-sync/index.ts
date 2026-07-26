/**
 * POST /order-sync
 * Auth: user JWT (manual "Sync now") OR header x-cron-secret (pg_cron / scheduler).
 * Body: { connectionId?: string } — omit to sync all active connections (cron).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { upsertCanonicalOrders } from '../_shared/channels/normalize.ts';
import type { ChannelSecrets, Platform, PollCursor } from '../_shared/channels/types.ts';

function serviceClient() {
    return createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
}

function isCron(req: Request): boolean {
    const secret = Deno.env.get('ORDER_SYNC_CRON_SECRET');
    if (!secret) return false;
    return req.headers.get('x-cron-secret') === secret;
}

type ConnRow = {
    id: string;
    user_id: string;
    platform: string;
    status: string;
    poll_cursor: PollCursor | null;
    consecutive_failures: number;
    auto_fulfill_on_shipped?: boolean;
};

async function syncOne(
    admin: ReturnType<typeof serviceClient>,
    conn: ConnRow,
    trigger: 'cron' | 'manual',
): Promise<{ ok: boolean; upserted: number; error?: string }> {
    // Skip if a poll is still "running" for this connection within 10 minutes.
    // Webhook runs are excluded: order-webhook now opens its run row up front for
    // idempotency, and one in flight (or stranded by an EF timeout) must not make
    // a manual "Sync now" silently return 0 orders for the next 10 minutes.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: running } = await admin
        .from('order_sync_runs')
        .select('id')
        .eq('connection_id', conn.id)
        .eq('status', 'running')
        .neq('trigger', 'webhook')
        .gte('started_at', tenMinAgo)
        .limit(1)
        .maybeSingle();

    if (running) {
        await admin.from('order_sync_runs').insert({
            connection_id: conn.id,
            user_id: conn.user_id,
            trigger,
            status: 'skipped',
            finished_at: new Date().toISOString(),
            error_message: 'another run in progress',
        });
        return { ok: true, upserted: 0 };
    }

    const { data: run, error: runErr } = await admin
        .from('order_sync_runs')
        .insert({
            connection_id: conn.id,
            user_id: conn.user_id,
            trigger,
            status: 'running',
        })
        .select('id')
        .single();
    if (runErr || !run) {
        return { ok: false, upserted: 0, error: runErr?.message ?? 'run insert failed' };
    }

    try {
        const { data: secretRow, error: secErr } = await admin
            .from('sales_channel_secrets')
            .select('credentials')
            .eq('connection_id', conn.id)
            .single();
        if (secErr || !secretRow) throw new Error('secrets not found');

        let secrets = secretRow.credentials as ChannelSecrets;
        const adapter = getAdapter(conn.platform);
        const refreshed = await adapter.refreshAuth(secrets);
        if (refreshed) {
            secrets = { ...secrets, ...refreshed };
            await admin
                .from('sales_channel_secrets')
                .update({ credentials: secrets, updated_at: new Date().toISOString() })
                .eq('connection_id', conn.id);
        }

        const cursor = (conn.poll_cursor ?? {}) as PollCursor;
        const { orders, nextCursor } = await adapter.fetchOrdersSince(secrets, cursor);
        const { upserted } = await upsertCanonicalOrders(admin, {
            userId: conn.user_id,
            connectionId: conn.id,
            platform: conn.platform as Platform,
            autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
        }, orders);

        const now = new Date().toISOString();
        await admin
            .from('sales_channel_connections')
            .update({
                poll_cursor: nextCursor,
                last_polled_at: now,
                status: 'active',
                last_error: null,
                consecutive_failures: 0,
                updated_at: now,
            })
            .eq('id', conn.id);

        await admin
            .from('order_sync_runs')
            .update({
                status: 'success',
                finished_at: now,
                orders_upserted: upserted,
            })
            .eq('id', run.id);

        return { ok: true, upserted };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[order-sync] connection', conn.id, msg);
        const now = new Date().toISOString();
        const failures = (conn.consecutive_failures ?? 0) + 1;
        await admin
            .from('sales_channel_connections')
            .update({
                status: failures >= 5 ? 'error' : 'active',
                last_error: msg.slice(0, 500),
                consecutive_failures: failures,
                updated_at: now,
            })
            .eq('id', conn.id);

        await admin
            .from('order_sync_runs')
            .update({
                status: 'error',
                finished_at: now,
                error_message: msg.slice(0, 1000),
            })
            .eq('id', run.id);

        return { ok: false, upserted: 0, error: msg };
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const cron = isCron(req);
    let userId: string | null = null;
    if (!cron) {
        const user = await getAuthenticatedUser(req);
        if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
        userId = user.id;
    }

    let connectionId: string | undefined;
    try {
        const body = await req.json().catch(() => ({}));
        connectionId = body?.connectionId;
    } catch {
        // empty body ok
    }

    const admin = serviceClient();
    const connSelect =
        'id, user_id, platform, status, poll_cursor, consecutive_failures, auto_fulfill_on_shipped';

    let query = admin
        .from('sales_channel_connections')
        .select(connSelect)
        .eq('status', 'active');

    if (connectionId) {
        query = query.eq('id', connectionId);
    }
    if (userId) {
        query = query.eq('user_id', userId);
    }

    // When user provides a specific connection, allow error status re-sync too
    if (connectionId && userId) {
        query = admin
            .from('sales_channel_connections')
            .select(connSelect)
            .eq('id', connectionId)
            .eq('user_id', userId)
            .in('status', ['active', 'error', 'pending']);
    }

    const { data: conns, error } = await query;
    if (error) {
        console.error('[order-sync] list', error);
        return jsonResponse({ error: 'Failed to list connections' }, 500);
    }

    if (!conns?.length) {
        return jsonResponse({ results: [], message: 'no connections' });
    }

    const trigger = cron ? 'cron' : 'manual';
    const results = [];
    for (const conn of conns as ConnRow[]) {
        results.push({
            connectionId: conn.id,
            platform: conn.platform,
            ...(await syncOne(admin, conn, trigger)),
        });
    }

    return jsonResponse({ results });
});
