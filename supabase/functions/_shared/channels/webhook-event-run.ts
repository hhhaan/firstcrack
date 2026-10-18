/**
 * Webhook idempotency rows on `order_sync_runs` (external_event_id unique per connection).
 * No Deno-only imports beyond captureEdgeException (no-ops under vitest).
 */
import { captureEdgeException } from '../sentry.ts';
import { STALE_RUN_MS, type PostgrestLikeError } from './run-lock.ts';

type FilterQuery = PromiseLike<{ data: unknown; error: PostgrestLikeError | null }> & {
    eq: (column: string, value: unknown) => FilterQuery;
    lt: (column: string, value: unknown) => FilterQuery;
    select: (columns: string) => {
        single: () => PromiseLike<{ data: { id: string } | null; error: PostgrestLikeError | null }>;
    };
    maybeSingle: () => PromiseLike<{
        data: { id: string; status: string; started_at: string } | null;
        error: PostgrestLikeError | null;
    }>;
};

type InsertQuery = PromiseLike<{ data: { id: string } | null; error: PostgrestLikeError | null }> & {
    select: (columns: string) => {
        single: () => PromiseLike<{ data: { id: string } | null; error: PostgrestLikeError | null }>;
    };
};

type UpdateQuery = FilterQuery;

export type WebhookEventRunClient = {
    from: (table: string) => {
        insert: (values: Record<string, unknown>) => InsertQuery;
        update: (values: Record<string, unknown>) => UpdateQuery;
        select: (columns: string) => FilterQuery;
    };
};

export type ClaimWebhookEventRunResult =
    | { ok: true; runId: string }
    | { ok: false; duplicate: true }
    | { ok: false; inProgress: true }
    | { ok: false; duplicate: false; error: string };

function isStaleWebhookClaim(startedAt: string): boolean {
    const startedMs = Date.parse(startedAt);
    if (Number.isNaN(startedMs)) return false;
    return startedMs < Date.now() - STALE_RUN_MS;
}

/** Insert a running webhook row, or reclaim a stale running duplicate (same external_event_id). */
export async function claimWebhookEventRun(
    admin: WebhookEventRunClient,
    args: { connectionId: string; userId: string; externalEventId: string },
): Promise<ClaimWebhookEventRunResult> {
    const { data: run, error: runErr } = await admin
        .from('order_sync_runs')
        .insert({
            connection_id: args.connectionId,
            user_id: args.userId,
            trigger: 'webhook',
            status: 'running',
            external_event_id: args.externalEventId,
        })
        .select('id')
        .single();

    if (!runErr && run) {
        return { ok: true, runId: run.id };
    }

    if (runErr?.code !== '23505') {
        return { ok: false, duplicate: false, error: runErr?.message ?? 'run insert failed' };
    }

    const staleBeforeIso = new Date(Date.now() - STALE_RUN_MS).toISOString();
    const { data: existing, error: fetchErr } = await admin
        .from('order_sync_runs')
        .select('id, status, started_at')
        .eq('connection_id', args.connectionId)
        .eq('external_event_id', args.externalEventId)
        .maybeSingle();

    if (fetchErr) {
        console.error('[webhook-event-run] lookup duplicate claim', fetchErr);
        await captureEdgeException(fetchErr, {
            function: 'order-webhook',
            status: 500,
            tags: { step: 'webhook-claim-lookup' },
        });
        return { ok: false, duplicate: false, error: fetchErr.message ?? 'claim lookup failed' };
    }

    if (!existing) {
        return { ok: false, duplicate: false, error: 'claim conflict' };
    }
    if (existing.status === 'success') {
        return { ok: false, duplicate: true };
    }
    if (existing.status === 'running') {
        if (!isStaleWebhookClaim(existing.started_at)) {
            return { ok: false, inProgress: true };
        }
    } else {
        return { ok: false, inProgress: true };
    }

    const { data: reclaimed, error: reclaimErr } = await admin
        .from('order_sync_runs')
        .update({
            status: 'running',
            started_at: new Date().toISOString(),
            finished_at: null,
            error_message: null,
            orders_upserted: 0,
            user_id: args.userId,
        })
        .eq('id', existing.id)
        .eq('status', 'running')
        .lt('started_at', staleBeforeIso)
        .select('id')
        .single();

    if (reclaimErr) {
        console.error('[webhook-event-run] reclaim stale webhook claim', reclaimErr);
        await captureEdgeException(reclaimErr, {
            function: 'order-webhook',
            status: 500,
            tags: { step: 'webhook-claim-reclaim' },
        });
        return { ok: false, duplicate: false, error: reclaimErr.message ?? 'claim reclaim failed' };
    }
    if (!reclaimed) {
        return { ok: false, inProgress: true };
    }

    console.warn('[webhook-event-run] reclaimed stale webhook claim', reclaimed.id);
    return { ok: true, runId: reclaimed.id };
}

export async function releaseWebhookEventClaim(
    admin: WebhookEventRunClient,
    runId: string,
    errorMessage: string,
): Promise<void> {
    const { error } = await admin
        .from('order_sync_runs')
        .update({
            status: 'error',
            finished_at: new Date().toISOString(),
            external_event_id: null,
            error_message: errorMessage.slice(0, 1000),
        })
        .eq('id', runId);
    if (error) {
        console.error('[order-webhook] release webhook event claim', error);
        await captureEdgeException(error, {
            function: 'order-webhook',
            status: 500,
            tags: { step: 'release-webhook-claim' },
        });
    }
}

export async function completeWebhookEventRun(
    admin: WebhookEventRunClient,
    runId: string,
    ordersUpserted: number,
): Promise<void> {
    const { error } = await admin
        .from('order_sync_runs')
        .update({
            status: 'success',
            finished_at: new Date().toISOString(),
            orders_upserted: ordersUpserted,
        })
        .eq('id', runId);
    if (error) {
        console.error('[order-webhook] complete webhook event run', error);
        await captureEdgeException(error, {
            function: 'order-webhook',
            status: 500,
            tags: { step: 'complete-webhook-run' },
        });
    }
}
