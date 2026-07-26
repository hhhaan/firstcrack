/**
 * POST /order-sync
 * Auth: user JWT (manual "Sync now") OR header x-cron-secret (pg_cron / scheduler).
 * Body: { connectionId?: string } — omit to sync all active connections (cron).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { upsertCanonicalOrders } from '../_shared/channels/normalize.ts';
import { loadSecretsSession } from '../_shared/channels/secrets-session.ts';
import type { Platform, PollCursor } from '../_shared/channels/types.ts';

/**
 * A 'running' row holds the per-connection lock; past this age it is treated as a dead run.
 * Must stay ABOVE the Edge Function wall-clock limit — lower it below that and reclaim starts
 * stealing the lock from a live invocation, i.e. two concurrent Cafe24 refresh_token rotations.
 */
const STALE_RUN_MS = 10 * 60 * 1000;
/** Cron sweeps every active connection, so one invocation must stay well inside the wall clock. */
const INVOCATION_BUDGET_MS = 90 * 1000;
/** Connections handled per invocation. Ordered least-recently-polled first → round robin. */
const MAX_CONNECTIONS_PER_RUN = 25;

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

/**
 * An invocation killed mid-run (wall-clock timeout, deploy) leaves its row on 'running' forever,
 * and the partial unique index would keep that connection locked out for good.
 */
async function reclaimStaleRuns(admin: ReturnType<typeof serviceClient>): Promise<void> {
    const { error } = await admin
        .from('order_sync_runs')
        .update({
            status: 'error',
            finished_at: new Date().toISOString(),
            error_message: 'run timed out — reclaimed',
        })
        .eq('status', 'running')
        .lt('started_at', new Date(Date.now() - STALE_RUN_MS).toISOString());
    if (error) console.error('[order-sync] reclaim stale runs', error);
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
): Promise<{ ok: boolean; upserted: number; skipped?: boolean; error?: string }> {
    // The insert is the lock: a partial unique index allows one 'running' row per connection.
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
        if (runErr?.code === '23505') {
            await admin.from('order_sync_runs').insert({
                connection_id: conn.id,
                user_id: conn.user_id,
                trigger,
                status: 'skipped',
                finished_at: new Date().toISOString(),
                error_message: 'another run in progress',
            });
            return { ok: true, upserted: 0, skipped: true };
        }
        return { ok: false, upserted: 0, error: runErr?.message ?? 'run insert failed' };
    }

    try {
        const session = await loadSecretsSession(admin, conn.id);
        const adapter = getAdapter(conn.platform);
        const refreshed = await adapter.refreshAuth(session.current());
        if (refreshed) await session.rotate(refreshed);

        const cursor = (conn.poll_cursor ?? {}) as PollCursor;
        const { orders, nextCursor } = await adapter.fetchOrdersSince(
            session.current(),
            cursor,
            session.rotate,
        );
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
                // Stamped on failure too, otherwise a permanently broken connection stays at the
                // head of the least-recently-polled queue and starves every other one.
                last_polled_at: now,
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
    await reclaimStaleRuns(admin);

    const connSelect =
        'id, user_id, platform, status, poll_cursor, last_polled_at, consecutive_failures, auto_fulfill_on_shipped';

    let query = admin.from('sales_channel_connections').select(connSelect);

    if (connectionId && userId) {
        // When user provides a specific connection, allow error status re-sync too
        query = query
            .eq('id', connectionId)
            .eq('user_id', userId)
            .in('status', ['active', 'error', 'pending']);
    } else {
        query = query.eq('status', 'active');
        if (connectionId) query = query.eq('id', connectionId);
        if (userId) query = query.eq('user_id', userId);
    }

    const { data: conns, error } = await query
        .order('last_polled_at', { ascending: true, nullsFirst: true })
        .limit(MAX_CONNECTIONS_PER_RUN);
    if (error) {
        console.error('[order-sync] list', error);
        return jsonResponse({ error: 'Failed to list connections' }, 500);
    }

    if (!conns?.length) {
        return jsonResponse({ results: [], message: 'no connections' });
    }

    const trigger = cron ? 'cron' : 'manual';
    const deadline = Date.now() + INVOCATION_BUDGET_MS;
    const results = [];
    let truncated = false;

    for (const conn of conns as ConnRow[]) {
        // Stop before the platform kills the invocation: a hard kill would strand every remaining
        // connection's run row on 'running'. Whatever is left is picked up by the next cron tick.
        if (Date.now() > deadline) {
            truncated = true;
            break;
        }
        results.push({
            connectionId: conn.id,
            platform: conn.platform,
            ...(await syncOne(admin, conn, trigger)),
        });
    }

    return jsonResponse({ results, truncated });
});
