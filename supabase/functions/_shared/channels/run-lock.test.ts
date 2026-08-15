import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    acquireDispatchRunLock,
    reclaimStaleRuns,
    releaseRunLock,
    STALE_RUN_MS,
    type PostgrestLikeError,
    type RunLockClient,
} from './run-lock.ts';

type Op = {
    method: 'insert' | 'update';
    values: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
    selected?: string;
};

function mockAdmin(opts: {
    insert?:
        | { data: { id: string } | null; error: PostgrestLikeError | null }
        | Array<{ data: { id: string } | null; error: PostgrestLikeError | null }>;
    updateError?: PostgrestLikeError | null;
}): { admin: RunLockClient; ops: Op[] } {
    const ops: Op[] = [];
    const insertQueue = Array.isArray(opts.insert)
        ? [...opts.insert]
        : [opts.insert ?? { data: { id: 'run-1' }, error: null }];

    const nextInsert = () =>
        insertQueue.length > 1
            ? insertQueue.shift()!
            : (insertQueue[0] ?? { data: { id: 'run-1' }, error: null });

    const chain = (method: Op['method'], values: Record<string, unknown>): never => {
        const op: Op = { method, values, filters: [] };
        const builder = {
            eq: (column: string, value: unknown) => {
                op.filters.push(['eq', column, value]);
                return builder;
            },
            neq: (column: string, value: unknown) => {
                op.filters.push(['neq', column, value]);
                return builder;
            },
            lt: (column: string, value: unknown) => {
                op.filters.push(['lt', column, value]);
                return builder;
            },
            select: (columns: string) => {
                op.selected = columns;
                return builder;
            },
            single: () => {
                ops.push(op);
                return Promise.resolve(nextInsert());
            },
            then: (resolve: (v: { data: unknown; error: PostgrestLikeError | null }) => unknown, reject?: (e: unknown) => unknown) => {
                ops.push(op);
                const result =
                    method === 'insert'
                        ? nextInsert()
                        : { data: null, error: opts.updateError ?? null };
                return Promise.resolve(result).then(resolve, reject);
            },
        };
        return builder as never;
    };

    return {
        ops,
        admin: {
            from: (table: string) => {
                expect(table).toBe('order_sync_runs');
                return {
                    insert: (values: Record<string, unknown>) => chain('insert', values),
                    update: (values: Record<string, unknown>) => chain('update', values),
                };
            },
        },
    };
}

describe('reclaimStaleRuns', () => {
    it('flips non-webhook running rows older than STALE_RUN_MS to error', async () => {
        const { admin, ops } = mockAdmin({});
        const before = Date.now();
        await reclaimStaleRuns(admin);
        const after = Date.now();

        expect(ops).toHaveLength(1);
        expect(ops[0].method).toBe('update');
        expect(ops[0].values).toMatchObject({
            status: 'error',
            error_message: 'run timed out — reclaimed',
        });
        expect(ops[0].filters).toContainEqual(['eq', 'status', 'running']);
        expect(ops[0].filters).toContainEqual(['neq', 'trigger', 'webhook']);

        const lt = ops[0].filters.find((f) => f[0] === 'lt' && f[1] === 'started_at');
        expect(lt).toBeTruthy();
        const cutoff = Date.parse(String(lt![2]));
        expect(cutoff).toBeGreaterThanOrEqual(before - STALE_RUN_MS);
        expect(cutoff).toBeLessThanOrEqual(after - STALE_RUN_MS);
    });
});

describe('acquireDispatchRunLock', () => {
    it('reclaims then inserts a running dispatch row', async () => {
        const { admin, ops } = mockAdmin({ insert: { data: { id: 'run-dispatch' }, error: null } });
        const result = await acquireDispatchRunLock(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
        });

        expect(result).toEqual({ ok: true, runId: 'run-dispatch' });
        expect(ops[0].method).toBe('update');
        expect(ops[0].filters).toContainEqual(['neq', 'trigger', 'webhook']);
        expect(ops[1]).toMatchObject({
            method: 'insert',
            selected: 'id',
            values: {
                connection_id: 'conn-1',
                user_id: 'user-1',
                trigger: 'dispatch',
                status: 'running',
            },
        });
    });

    it('23505 → skipped row and conflict (same unique index as order-sync)', async () => {
        const { admin, ops } = mockAdmin({
            insert: [
                { data: null, error: { code: '23505', message: 'duplicate key' } },
                { data: { id: 'skipped' }, error: null },
            ],
        });
        const result = await acquireDispatchRunLock(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
        });

        expect(result).toEqual({ ok: false, conflict: true });
        const inserts = ops.filter((o) => o.method === 'insert');
        expect(inserts).toHaveLength(2);
        expect(inserts[1].values).toMatchObject({
            connection_id: 'conn-1',
            user_id: 'user-1',
            trigger: 'dispatch',
            status: 'skipped',
            error_message: 'another run in progress',
        });
        expect(inserts[1].values.finished_at).toEqual(expect.any(String));
    });

    it('other insert errors surface as error', async () => {
        const { admin } = mockAdmin({
            insert: { data: null, error: { code: '42501', message: 'permission denied' } },
        });
        const result = await acquireDispatchRunLock(admin, {
            connectionId: 'conn-1',
            userId: 'user-1',
        });
        expect(result).toEqual({ ok: false, conflict: false, error: 'permission denied' });
    });
});

describe('releaseRunLock', () => {
    it('updates the running row to success', async () => {
        const { admin, ops } = mockAdmin({});
        await releaseRunLock(admin, 'run-1', { status: 'success' });
        expect(ops).toEqual([
            expect.objectContaining({
                method: 'update',
                values: expect.objectContaining({ status: 'success' }),
                filters: [['eq', 'id', 'run-1']],
            }),
        ]);
        expect(ops[0].values.finished_at).toEqual(expect.any(String));
        expect(ops[0].values).not.toHaveProperty('error_message');
    });

    it('writes a truncated error_message on failure', async () => {
        const { admin, ops } = mockAdmin({});
        await releaseRunLock(admin, 'run-1', {
            status: 'error',
            errorMessage: 'x'.repeat(1200),
        });
        expect(ops[0].values.status).toBe('error');
        expect(String(ops[0].values.error_message)).toHaveLength(1000);
    });
});

describe('order-dispatch wires the run lock', () => {
    it('acquires and releases via the shared helper before refreshAuth', () => {
        const dir = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(join(dir, '../../order-dispatch/index.ts'), 'utf8');
        expect(src).toContain('acquireDispatchRunLock');
        expect(src).toContain('releaseRunLock');
        expect(src.indexOf('acquireDispatchRunLock')).toBeLessThan(src.indexOf('refreshAuth'));
        expect(src).toContain("error: 'another run in progress'");
    });
});
