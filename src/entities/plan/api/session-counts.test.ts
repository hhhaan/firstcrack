import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from: (...args: unknown[]) => from(...args) },
}));

import { countSessionsByBatch, SESSION_COUNT_PAGE } from './session-counts';

function page(rows: { plan_batch_id: string | null }[]) {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'order', 'range']) {
        q[method] = vi.fn(() => q);
    }
    // biome-ignore lint/suspicious/noThenProperty: supabase builder is a thenable by design — mock mirrors it
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
    return q;
}

describe('countSessionsByBatch', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('returns an empty map without querying when there are no batches', async () => {
        await expect(countSessionsByBatch([])).resolves.toEqual(new Map());
        expect(from).not.toHaveBeenCalled();
    });

    it('reads another page when the first page is full', async () => {
        const first = Array.from({ length: SESSION_COUNT_PAGE }, () => ({ plan_batch_id: 'b1' }));
        const second = [{ plan_batch_id: 'b1' }, { plan_batch_id: 'b2' }];
        const firstQuery = page(first);
        const secondQuery = page(second);
        from.mockReturnValueOnce(firstQuery).mockReturnValueOnce(secondQuery);

        const counts = await countSessionsByBatch(['b1', 'b2']);

        expect(counts.get('b1')).toBe(SESSION_COUNT_PAGE + 1);
        expect(counts.get('b2')).toBe(1);
        expect(firstQuery.range).toHaveBeenCalledWith(0, SESSION_COUNT_PAGE - 1);
        expect(secondQuery.range).toHaveBeenCalledWith(SESSION_COUNT_PAGE, SESSION_COUNT_PAGE * 2 - 1);
    });
});
