/**
 * Per-connection run lock on `order_sync_runs`.
 *
 * A 'running' row is the lock: the partial unique index
 * `order_sync_runs_one_running_per_connection` allows one in-flight cron / manual /
 * dispatch run per connection. Webhook rows are outside it (their 23505 means
 * "duplicate delivery", not "lock held").
 *
 * No Deno / npm imports — vitest must be able to load this file.
 * `captureEdgeException` no-ops without a Deno global.
 */

/**
 * A 'running' row older than this is treated as a dead run.
 * Must stay ABOVE the Edge Function wall-clock limit — lower it below that and reclaim
 * starts stealing the lock from a live invocation, i.e. two concurrent Cafe24
 * refresh_token rotations.
 */
import { captureEdgeException } from '../sentry.ts';

export const STALE_RUN_MS = 10 * 60 * 1000;

export type PostgrestLikeError = { code?: string; message?: string };

type FilterQuery = PromiseLike<{ error: PostgrestLikeError | null }> & {
    eq: (column: string, value: unknown) => FilterQuery;
    neq: (column: string, value: unknown) => FilterQuery;
    lt: (column: string, value: unknown) => FilterQuery;
};

type InsertQuery = PromiseLike<{ error: PostgrestLikeError | null }> & {
    select: (columns: string) => {
        // PromiseLike: supabase-js `single()` is a thenable PostgrestBuilder, not a Promise.
        single: () => PromiseLike<{
            data: { id: string } | null;
            error: PostgrestLikeError | null;
        }>;
    };
};

/** Minimal `order_sync_runs` writer — real Supabase client or a test mock. */
export type RunLockClient = {
    from: (table: string) => {
        insert: (values: Record<string, unknown>) => InsertQuery;
        update: (values: Record<string, unknown>) => FilterQuery;
    };
};

/**
 * An invocation killed mid-run (wall-clock timeout, deploy) leaves its row on
 * 'running' forever, and the partial unique index would keep that connection
 * locked out for good.
 *
 * Webhook runs are deliberately excluded: order-webhook owns their lifecycle
 * (it clears its own idempotency key on failure so the platform retry is let
 * through), and reclaiming one here would leave the key in place and turn a
 * legitimate retry into a discarded "duplicate". Dispatch rows are included
 * (`trigger <> 'webhook'`), so a dead dispatch cannot block the next sync.
 */
export async function reclaimStaleRuns(admin: RunLockClient): Promise<void> {
    const { error } = await admin
        .from('order_sync_runs')
        .update({
            status: 'error',
            finished_at: new Date().toISOString(),
            error_message: 'run timed out — reclaimed',
        })
        .eq('status', 'running')
        .neq('trigger', 'webhook')
        .lt('started_at', new Date(Date.now() - STALE_RUN_MS).toISOString());
    if (error) {
        console.error('[run-lock] reclaim stale runs', error);
        await captureEdgeException(error, { function: 'run-lock', status: 500, tags: { step: 'reclaim' } });
    }
}

export type ConnectionRunTrigger = 'cron' | 'manual' | 'dispatch' | 'products';

export type AcquireConnectionRunLockResult =
    | { ok: true; runId: string }
    | { ok: false; conflict: true }
    | { ok: false; conflict: false; error: string };

export type AcquireDispatchRunLockResult = AcquireConnectionRunLockResult;

/**
 * Insert the per-connection `running` row (partial unique index). Reclaims stale runs first.
 */
export async function acquireConnectionRunLock(
    admin: RunLockClient,
    args: { connectionId: string; userId: string; trigger: ConnectionRunTrigger },
): Promise<AcquireConnectionRunLockResult> {
    await reclaimStaleRuns(admin);

    const { data: run, error: runErr } = await admin
        .from('order_sync_runs')
        .insert({
            connection_id: args.connectionId,
            user_id: args.userId,
            trigger: args.trigger,
            status: 'running',
        })
        .select('id')
        .single();

    if (runErr || !run) {
        if (runErr?.code === '23505') {
            await admin.from('order_sync_runs').insert({
                connection_id: args.connectionId,
                user_id: args.userId,
                trigger: args.trigger,
                status: 'skipped',
                finished_at: new Date().toISOString(),
                error_message: 'another run in progress',
            });
            return { ok: false, conflict: true };
        }
        return { ok: false, conflict: false, error: runErr?.message ?? 'run insert failed' };
    }

    return { ok: true, runId: run.id };
}

/**
 * Take the same per-connection lock order-sync uses, with `trigger: 'dispatch'`.
 * Reclaims stale cron/manual/dispatch runs first so a dead row cannot block us.
 */
export async function acquireDispatchRunLock(
    admin: RunLockClient,
    args: { connectionId: string; userId: string },
): Promise<AcquireDispatchRunLockResult> {
    return acquireConnectionRunLock(admin, { ...args, trigger: 'dispatch' });
}

export type ReleaseRunLockOutcome = {
    status: 'success' | 'error';
    errorMessage?: string;
};

/** Flip the running row off the unique index so the next sync/dispatch can proceed. */
export async function releaseRunLock(
    admin: RunLockClient,
    runId: string,
    outcome: ReleaseRunLockOutcome,
): Promise<void> {
    const { error } = await admin
        .from('order_sync_runs')
        .update({
            status: outcome.status,
            finished_at: new Date().toISOString(),
            ...(outcome.errorMessage ? { error_message: outcome.errorMessage.slice(0, 1000) } : {}),
        })
        .eq('id', runId);
    if (error) {
        console.error('[run-lock] release', error);
        await captureEdgeException(error, { function: 'run-lock', status: 500, tags: { step: 'release' } });
    }
}
