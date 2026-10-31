import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
    beginOptimisticRoastSessionDelete,
    beginOptimisticRoastSessionEdit,
    beginOptimisticSessionBeanOrigin,
    finishOptimisticRoastSessionEdit,
    patchOptimisticRoastSessionBaseline,
    revertOptimisticRoastSessionEdit,
} from './historyOptimistic';

const userId = 'owner';
const root = ['roast_sessions', userId] as const;
const row = (id: string): RoastSessionWithRelations =>
    ({
        id,
        status: 'completed',
        notes: 'old',
        weight_grams: 1000,
        output_weight_grams: null,
    }) as RoastSessionWithRelations;
const patch = (id: string, values: Partial<RoastSessionWithRelations>) => (session: RoastSessionWithRelations) =>
    session.id === id ? { ...session, ...values } : session;

const setup = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = root;
    const page = [...root, 'paginated', 1] as const;
    const infinite = [...root, 'infinite'] as const;
    const detail = [...root, 'detail', 'a'] as const;
    qc.setQueryData(list, [row('a'), row('b')]);
    qc.setQueryData(page, { data: [row('a'), row('b')], total: 2 });
    qc.setQueryData(infinite, { pages: [{ data: [row('a'), row('b')], total: 2 }], pageParams: [1] });
    qc.setQueryData(detail, row('a'));
    return { qc, list, page, infinite, detail };
};

const listRows = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryData<RoastSessionWithRelations[]>(key) ?? [];

describe('roast history optimistic journal', () => {
    it('does not recreate a removed detail query when another edit replays', async () => {
        const { qc, list, detail } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        qc.removeQueries({ queryKey: detail, exact: true });

        const second = await beginOptimisticRoastSessionEdit(qc, userId, patch('b', { notes: 'second' }));

        expect(qc.getQueryData(detail)).toBeUndefined();
        expect(listRows(qc, list)).toMatchObject([
            { id: 'a', notes: 'first' },
            { id: 'b', notes: 'second' },
        ]);
        await finishOptimisticRoastSessionEdit(qc, userId, first, async () => undefined);
        await finishOptimisticRoastSessionEdit(qc, userId, second, async () => undefined);
        expect(qc.getQueryData(detail)).toBeUndefined();
    });

    it('removes two failed same-field edits without resurrecting either', async () => {
        const { qc, list } = setup();
        const a = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        const b = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'second' }));

        revertOptimisticRoastSessionEdit(qc, userId, a);
        expect(listRows(qc, list)[0].notes).toBe('second');
        revertOptimisticRoastSessionEdit(qc, userId, b);
        expect(listRows(qc, list)[0].notes).toBe('old');
    });

    it('removes two failed same-field edits in reverse order', async () => {
        const { qc, list } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        const second = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'second' }));

        revertOptimisticRoastSessionEdit(qc, userId, second);
        expect(listRows(qc, list)[0].notes).toBe('first');
        revertOptimisticRoastSessionEdit(qc, userId, first);
        expect(listRows(qc, list)[0].notes).toBe('old');
    });

    it('preserves a bean relink when an overlapping origin edit fails', async () => {
        const { qc, list } = setup();
        qc.setQueryData(list, [{ ...row('a'), bean_id: 'old', beans: { name: 'Old', origin: 'Ethiopia' } }, row('b')]);
        const origin = await beginOptimisticSessionBeanOrigin(qc, userId, 'old', 'Colombia');
        const relink = await beginOptimisticRoastSessionEdit(
            qc,
            userId,
            patch('a', {
                bean_id: 'new',
                beans: { name: 'New', origin: 'Kenya', farm: null, process: null, region: null, variety: null },
            }),
        );

        revertOptimisticRoastSessionEdit(qc, userId, origin);
        expect(listRows(qc, list)[0]).toMatchObject({ bean_id: 'new', beans: { name: 'New', origin: 'Kenya' } });
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            origin,
            vi.fn(async () => undefined),
        );
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            relink,
            vi.fn(async () => undefined),
        );
    });

    it('runs every completed operation reconciliation when the group drains', async () => {
        const { qc } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        const second = await beginOptimisticRoastSessionEdit(qc, userId, patch('b', { notes: 'second' }));
        const firstReconcile = vi.fn(async () => undefined);
        const secondReconcile = vi.fn(async () => undefined);

        await finishOptimisticRoastSessionEdit(qc, userId, first, firstReconcile);
        expect(firstReconcile).not.toHaveBeenCalled();
        await finishOptimisticRoastSessionEdit(qc, userId, second, secondReconcile);

        expect(firstReconcile).toHaveBeenCalledOnce();
        expect(secondReconcile).toHaveBeenCalledOnce();
    });

    it('waits for reconciliation before starting a new edit', async () => {
        const { qc, list } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        let release: (() => void) | undefined;
        const finishing = finishOptimisticRoastSessionEdit(
            qc,
            userId,
            first,
            () => new Promise<void>((resolve) => (release = resolve)),
        );
        const next = beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'next' }));
        await Promise.resolve();
        expect(listRows(qc, list)[0].notes).toBe('first');

        release?.();
        await finishing;
        await next;
        expect(listRows(qc, list)[0].notes).toBe('next');
    });

    it('allows a new edit after reconciliation fails', async () => {
        const { qc, list } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        const finishing = finishOptimisticRoastSessionEdit(qc, userId, first, async () => {
            throw new Error('refetch failed');
        });
        const rejection = expect(finishing).rejects.toThrow('refetch failed');

        const next = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'next' }));

        await rejection;
        expect(listRows(qc, list)[0].notes).toBe('next');
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            next,
            vi.fn(async () => undefined),
        );
    });

    it('rechecks reconciliation that starts while cancelling a new edit', async () => {
        const { qc, list } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        let releaseCancel: (() => void) | undefined;
        let cancelCalls = 0;
        vi.spyOn(qc, 'cancelQueries').mockImplementation(async () => {
            cancelCalls += 1;
            if (cancelCalls === 1) await new Promise<void>((resolve) => (releaseCancel = resolve));
        });

        const nextPromise = beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'next' }));
        let releaseReconcile: (() => void) | undefined;
        const finishing = finishOptimisticRoastSessionEdit(
            qc,
            userId,
            first,
            () => new Promise<void>((resolve) => (releaseReconcile = resolve)),
        );
        releaseCancel?.();
        await Promise.resolve();
        expect(listRows(qc, list)[0].notes).toBe('first');

        releaseReconcile?.();
        await finishing;
        const next = await nextPromise;
        expect(cancelCalls).toBe(2);
        expect(listRows(qc, list)[0].notes).toBe('next');

        revertOptimisticRoastSessionEdit(qc, userId, next);
        expect(listRows(qc, list)[0].notes).toBe('first');
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            next,
            vi.fn(async () => undefined),
        );
    });

    it('retains a successful later edit when an earlier edit fails', async () => {
        const { qc, list } = setup();
        const first = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'first' }));
        const second = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'second' }));
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            second,
            vi.fn(async () => undefined),
        );

        revertOptimisticRoastSessionEdit(qc, userId, first);
        expect(listRows(qc, list)[0].notes).toBe('second');
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            first,
            vi.fn(async () => undefined),
        );
    });

    it('rebases different fields, sessions, and every history cache shape', async () => {
        const { qc, list, page, infinite, detail } = setup();
        const failed = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'failed' }));
        const weight = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { weight_grams: 900 }));
        const other = await beginOptimisticRoastSessionEdit(qc, userId, patch('b', { notes: 'kept' }));

        revertOptimisticRoastSessionEdit(qc, userId, failed);

        expect(listRows(qc, list)).toMatchObject([
            { id: 'a', notes: 'old', weight_grams: 900 },
            { id: 'b', notes: 'kept' },
        ]);
        expect(qc.getQueryData<{ data: RoastSessionWithRelations[] }>(page)?.data).toMatchObject(listRows(qc, list));
        expect(
            qc.getQueryData<{ pages: Array<{ data: RoastSessionWithRelations[] }> }>(infinite)?.pages[0].data,
        ).toMatchObject(listRows(qc, list));
        expect(qc.getQueryData<RoastSessionWithRelations>(detail)).toMatchObject({ notes: 'old', weight_grams: 900 });

        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            failed,
            vi.fn(async () => undefined),
        );
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            weight,
            vi.fn(async () => undefined),
        );
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            other,
            vi.fn(async () => undefined),
        );
    });

    it('keeps a successful overlapping delete when another edit fails', async () => {
        const { qc, list, page } = setup();
        const failed = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'failed' }));
        const deleted = await beginOptimisticRoastSessionDelete(qc, userId, 'a');
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            deleted,
            vi.fn(async () => undefined),
        );

        revertOptimisticRoastSessionEdit(qc, userId, failed);

        expect(listRows(qc, list)).toMatchObject([{ id: 'b' }]);
        expect(qc.getQueryData<{ data: RoastSessionWithRelations[]; total: number }>(page)).toMatchObject({
            data: [{ id: 'b' }],
            total: 1,
        });
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            failed,
            vi.fn(async () => undefined),
        );
    });

    it('keeps explicit baseline patches but excludes unrelated manual writes from rollback', async () => {
        const { qc, list } = setup();
        const failed = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'failed' }));
        qc.setQueryData(list, [{ ...row('a'), notes: 'failed', duration_seconds: 600 }, row('b')]);
        patchOptimisticRoastSessionBaseline(qc, userId, (session) =>
            session.id === 'a' ? { ...session, tsv_path: 'profiles/a.tsv' } : session,
        );

        revertOptimisticRoastSessionEdit(qc, userId, failed);

        expect(listRows(qc, list)[0]).toMatchObject({ notes: 'old', tsv_path: 'profiles/a.tsv' });
        expect(listRows(qc, list)[0].duration_seconds).toBeUndefined();
        await finishOptimisticRoastSessionEdit(
            qc,
            userId,
            failed,
            vi.fn(async () => undefined),
        );
    });

    it('reapplies pending edits after an explicit query success', async () => {
        const { qc, list } = setup();
        const edit = await beginOptimisticRoastSessionEdit(qc, userId, patch('a', { notes: 'optimistic' }));

        await qc.fetchQuery({
            queryKey: list,
            queryFn: async () => [row('a'), { ...row('b'), notes: 'server' }],
            staleTime: 0,
        });

        expect(listRows(qc, list)).toMatchObject([
            { id: 'a', notes: 'optimistic' },
            { id: 'b', notes: 'server' },
        ]);
        await finishOptimisticRoastSessionEdit(qc, userId, edit, async () => {
            await qc.fetchQuery({
                queryKey: list,
                queryFn: async () => [
                    { ...row('a'), notes: 'canonical' },
                    { ...row('b'), notes: 'server' },
                ],
                staleTime: 0,
            });
        });
        expect(listRows(qc, list)[0].notes).toBe('canonical');
    });
});
