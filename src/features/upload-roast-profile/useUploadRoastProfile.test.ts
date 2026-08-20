import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { patchRoastSessionTsvPaths, roastSessionKeys } from '@entities/roast';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

describe('useUploadRoastProfile cache patch', () => {
    it('hook uses factory helper — no raw [roast_sessions] key', () => {
        const src = readFileSync(fileURLToPath(new URL('./useUploadRoastProfile.ts', import.meta.url)), 'utf8');
        expect(src).not.toMatch(/\['roast_sessions'\]/);
        expect(src).toContain('patchRoastSessionTsvPaths');
    });

    it('patches via roastSessionKeys.all(userId), not raw [roast_sessions]', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'setQueriesData');
        const inv = vi.spyOn(qc, 'invalidateQueries');

        patchRoastSessionTsvPaths(qc, 'user-1', 's1', 'r2/key.tsv', null);

        expect(spy.mock.calls.map((c) => c[0])).toContainEqual({ queryKey: roastSessionKeys.all('user-1') });
        expect(spy.mock.calls.map((c) => c[0])).not.toContainEqual({ queryKey: ['roast_sessions'] });
        expect(inv.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey)).toContainEqual(
            roastSessionKeys.detail('user-1', 's1'),
        );
        expect(inv.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey)).not.toContainEqual([
            'roast_sessions',
            'detail',
            's1',
        ]);
    });

    it('patches nested paginated page caches and skips filterMeta', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const uid = 'user-1';
        const pageKey = roastSessionKeys.paginated(uid, 'completed', 1, 10);
        const metaKey = roastSessionKeys.filterMeta(uid);
        const row = { id: 's1', status: 'completed', tsv_path: null, bbp_tsv_path: null };
        const meta = { roasted_at: '2026-01-01', beans: { origin: 'ET' } };
        qc.setQueryData(pageKey, { data: [row], total: 1 });
        qc.setQueryData(metaKey, [meta]);

        patchRoastSessionTsvPaths(qc, uid, 's1', 'r2/key.tsv', 'r2/bbp.tsv');

        expect(qc.getQueryData(pageKey)).toEqual({
            data: [{ ...row, tsv_path: 'r2/key.tsv', bbp_tsv_path: 'r2/bbp.tsv' }],
            total: 1,
        });
        expect(qc.getQueryData(metaKey)).toEqual([meta]);
    });
});
