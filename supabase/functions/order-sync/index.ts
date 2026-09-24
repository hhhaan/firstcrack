/**
 * POST /order-sync
 * Auth: user JWT (manual "Sync now") OR header x-cron-secret (pg_cron / scheduler).
 * Body: { connectionId?: string, workspaceOwnerId?: string } — omit connectionId to
 * sync all active connections (cron / manual sync-all).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse, resolveWorkspaceOwner } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { upsertCanonicalOrders } from '../_shared/channels/normalize.ts';
import { reclaimStaleRuns } from '../_shared/channels/run-lock.ts';
import { loadSecretsSession } from '../_shared/channels/secrets-session.ts';
import type { Platform, PollCursor } from '../_shared/channels/types.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';

/** Cron sweeps every active connection, so one invocation must stay well inside the wall clock. */
const INVOCATION_BUDGET_MS = 90 * 1000;
/** Connections handled per invocation. Ordered least-recently-polled first → round robin. */
const MAX_CONNECTIONS_PER_RUN = 25;

function serviceClient() {
    return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
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
): Promise<{
    ok: boolean;
    upserted: number;
    skipped?: boolean;
    error?: string;
    /** #109 EF-path guard: stock events the batch RPC refused (terminal orders) — never silent. */
    stockEventSkips?: Array<{ referenceId: string; orderId: string; orderStatus: string; reason: string }>;
}> {
    // The insert is the lock: a partial unique index allows one 'running' row per connection for
    // cron/manual/dispatch triggers. Webhook runs are outside it — see the migration for why.
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
        const { orders, nextCursor } = await adapter.fetchOrdersSince(session.current(), cursor, session.rotate);
        const { upserted, stockEventSkips } = await upsertCanonicalOrders(
            admin,
            {
                userId: conn.user_id,
                connectionId: conn.id,
                platform: conn.platform as Platform,
                autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
            },
            orders,
        );

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
                // Success run with refused deductions: keep the evidence on the run row.
                ...(stockEventSkips.length
                    ? { error_message: `stock events skipped: ${JSON.stringify(stockEventSkips).slice(0, 900)}` }
                    : {}),
            })
            .eq('id', run.id);

        return { ok: true, upserted, ...(stockEventSkips.length ? { stockEventSkips } : {}) };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[order-sync] connection', conn.id, msg);
        await captureEdgeException(e, {
            function: 'order-sync',
            status: 500,
            tags: { platform: conn.platform },
            extra: { connectionId: conn.id },
        });
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

serveWithSentry('order-sync', async (req) => {
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
    let workspaceOwnerId: string | undefined;
    try {
        const body = await req.json().catch(() => ({}));
        connectionId = body?.connectionId;
        workspaceOwnerId = body?.workspaceOwnerId;
    } catch {
        // empty body ok
    }

    const admin = serviceClient();
    await reclaimStaleRuns(admin);

    const connSelect =
        'id, user_id, platform, status, poll_cursor, last_polled_at, consecutive_failures, auto_fulfill_on_shipped';

    let query = admin.from('sales_channel_connections').select(connSelect);

    if (connectionId && userId) {
        // When user provides a specific connection, allow error status re-sync too.
        // Ownership is verified after the fetch against the row's user_id —
        // connection rows belong to the workspace owner, not auth.uid() (#155).
        query = query.eq('id', connectionId).in('status', ['active', 'error', 'pending']);
    } else {
        query = query.eq('status', 'active');
        if (connectionId) query = query.eq('id', connectionId);
        if (userId) {
            // Manual sync-all: rows belong to the workspace owner, so a member
            // filtering on auth.uid() would always see zero connections (#155).
            const owner = await resolveWorkspaceOwner(req, workspaceOwnerId, userId);
            if (!owner) return jsonResponse({ error: 'Forbidden' }, 403);
            query = query.eq('user_id', owner);
        }
    }

    const { data: conns, error } = await query
        .order('last_polled_at', { ascending: true, nullsFirst: true })
        .limit(MAX_CONNECTIONS_PER_RUN);
    if (error) {
        console.error('[order-sync] list', error);
        await captureEdgeException(error, { function: 'order-sync', status: 500 });
        return jsonResponse({ error: 'Failed to list connections' }, 500);
    }

    if (connectionId && userId) {
        // Verify workspace access against the row's owner via the caller's own
        // client (has_workspace_access RLS predicate). 403 for both "not yours"
        // and "does not exist" so existence is never revealed.
        const conn = (conns ?? [])[0] as ConnRow | undefined;
        const owner = conn ? await resolveWorkspaceOwner(req, conn.user_id, userId) : null;
        if (!owner) return jsonResponse({ error: 'Forbidden' }, 403);
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
