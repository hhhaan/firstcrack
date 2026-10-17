import { describe, expect, it } from 'vitest';
import { STALE_RUN_MS, type PostgrestLikeError } from './run-lock.ts';
import {
    claimWebhookEventRun,
    completeWebhookEventRun,
    releaseWebhookEventClaim,
    type WebhookEventRunClient,
} from './webhook-event-run.ts';

type Op = {
    kind: 'insert' | 'select' | 'update';
    values?: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
    terminal: 'insertSingle' | 'maybeSingle' | 'updateSingle' | 'updateVoid';
};

function mockWebhookRuns(handlers: {
    insert?: { data: { id: string } | null; error: PostgrestLikeError | null };
    existing?: { data: { id: string; status: string; started_at: string } | null; error: PostgrestLikeError | null };
    reclaim?: { data: { id: string } | null; error: PostgrestLikeError | null };
    updateError?: PostgrestLikeError | null;
}): { admin: WebhookEventRunClient; ops: Op[] } {
    const ops: Op[] = [];

    const filterQuery = (
        kind: Op['kind'],
        values?: Record<string, unknown>,
        terminal: Op['terminal'] = 'updateVoid',
    ): never => {
        const op: Op = { kind, values, filters: [], terminal };
        const builder = {
            eq: (column: string, value: unknown) => {
                op.filters.push(['eq', column, value]);
                return builder;
            },
            lt: (column: string, value: unknown) => {
                op.filters.push(['lt', column, value]);
                return builder;
            },
            select: (columns: string) => {
                if (kind === 'update') {
                    op.terminal = 'updateSingle';
                }
                expect(columns).toBeTruthy();
                return builder;
            },
            maybeSingle: () => {
                op.terminal = 'maybeSingle';
                ops.push(op);
                return Promise.resolve(
                    handlers.existing ?? { data: null, error: null },
                );
            },
            single: () => {
                ops.push(op);
                if (op.terminal === 'insertSingle') {
                    return Promise.resolve(handlers.insert ?? { data: { id: 'run-new' }, error: null });
                }
                if (op.terminal === 'updateSingle') {
                    return Promise.resolve(handlers.reclaim ?? { data: { id: 'stale-run' }, error: null });
                }
                return Promise.resolve({ data: null, error: null });
            },
            then: (
                resolve: (v: { data: unknown; error: PostgrestLikeError | null }) => unknown,
                reject?: (e: unknown) => unknown,
            ) => {
                ops.push(op);
                const result = { data: null, error: handlers.updateError ?? null };
                return Promise.resolve(result).then(resolve, reject);
            },
        };
        return builder as never;
    };

    const admin: WebhookEventRunClient = {
        from: (table) => {
            expect(table).toBe('order_sync_runs');
            return {
                insert: (values) => {
                    const q = filterQuery('insert', values, 'insertSingle');
                    return q;
                },
                update: (values) => filterQuery('update', values),
                select: (columns) => filterQuery('select', undefined, 'maybeSingle'),
            };
        },
    };

    return { admin, ops };
}

describe('claimWebhookEventRun', () => {
    it('returns run id on fresh insert', async () => {
        const { admin } = mockWebhookRuns({ insert: { data: { id: 'run-1' }, error: null } });
        const result = await claimWebhookEventRun(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
            externalEventId: 'evt-1',
        });
        expect(result).toEqual({ ok: true, runId: 'run-1' });
    });

    it('surfaces lookup errors after 23505 instead of acking duplicate', async () => {
        const { admin } = mockWebhookRuns({
            insert: { data: null, error: { code: '23505', message: 'dup' } },
            existing: { data: null, error: { message: 'db timeout' } },
        });
        const result = await claimWebhookEventRun(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
            externalEventId: 'evt-1',
        });
        expect(result).toEqual({ ok: false, duplicate: false, error: 'db timeout' });
    });

    it('23505 on a fresh running row → duplicate', async () => {
        const recent = new Date().toISOString();
        const { admin } = mockWebhookRuns({
            insert: { data: null, error: { code: '23505', message: 'dup' } },
            existing: { data: { id: 'run-live', status: 'running', started_at: recent }, error: null },
        });
        const result = await claimWebhookEventRun(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
            externalEventId: 'evt-1',
        });
        expect(result).toEqual({ ok: false, duplicate: true });
    });

    it('23505 on a stale running row → reclaims and proceeds', async () => {
        const staleStarted = new Date(Date.now() - STALE_RUN_MS - 60_000).toISOString();
        const { admin, ops } = mockWebhookRuns({
            insert: { data: null, error: { code: '23505', message: 'dup' } },
            existing: { data: { id: 'stale-run', status: 'running', started_at: staleStarted }, error: null },
            reclaim: { data: { id: 'stale-run' }, error: null },
        });
        const result = await claimWebhookEventRun(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
            externalEventId: 'evt-1',
        });
        expect(result).toEqual({ ok: true, runId: 'stale-run' });
        const reclaim = ops.find((o) => o.kind === 'update' && o.terminal === 'updateSingle');
        expect(reclaim?.filters).toContainEqual(['eq', 'id', 'stale-run']);
        expect(reclaim?.filters).toContainEqual(['eq', 'status', 'running']);
        expect(reclaim?.filters.some((f) => f[0] === 'lt' && f[1] === 'started_at')).toBe(true);
    });
});

describe('releaseWebhookEventClaim', () => {
    it('updates the row and nulls external_event_id', async () => {
        const { admin, ops } = mockWebhookRuns({});
        await releaseWebhookEventClaim(admin, 'run-1', 'boom');
        expect(ops[0]).toMatchObject({
            kind: 'update',
            values: expect.objectContaining({
                status: 'error',
                external_event_id: null,
                error_message: 'boom',
            }),
            filters: [['eq', 'id', 'run-1']],
        });
    });
});

describe('completeWebhookEventRun', () => {
    it('marks success with orders_upserted', async () => {
        const { admin, ops } = mockWebhookRuns({});
        await completeWebhookEventRun(admin, 'run-1', 1);
        expect(ops[0].values).toMatchObject({ status: 'success', orders_upserted: 1 });
    });
});
