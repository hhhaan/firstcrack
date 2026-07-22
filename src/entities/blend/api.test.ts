import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryChain = {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
};

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

import { blendApi } from './api';

const blendInsert = {
    user_id: 'u1',
    name: 'House',
    description: '',
};

const components = [{ bean_id: 'b1', ratio_pct: 100 }];

/** Supabase builder: chainable methods + awaitable (Promise with methods). */
function chainable(result: { data: unknown; error: unknown }): QueryChain & Promise<{ data: unknown; error: unknown }> {
    const resolved = Promise.resolve(result);
    const q = resolved as QueryChain & Promise<{ data: unknown; error: unknown }>;
    q.select = vi.fn(() => q);
    q.insert = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve(result));
    return q;
}

describe('blendApi.create', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('throws when blend insert fails', async () => {
        const err = { message: 'insert blend failed', code: '23505' };
        from.mockReturnValueOnce(chainable({ data: null, error: err }));

        await expect(blendApi.create(blendInsert, components)).rejects.toEqual(err);
        expect(from).toHaveBeenCalledWith('blends');
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('throws when component insert fails after blend insert', async () => {
        const newBlend = { id: 'blend-1', ...blendInsert };
        const compErr = { message: 'insert components failed', code: '23514' };

        const blendQ = chainable({ data: newBlend, error: null });
        const compQ = chainable({ data: null, error: compErr });

        from.mockReturnValueOnce(blendQ).mockReturnValueOnce(compQ);

        await expect(blendApi.create(blendInsert, components)).rejects.toEqual(compErr);
        expect(from).toHaveBeenNthCalledWith(1, 'blends');
        expect(from).toHaveBeenNthCalledWith(2, 'blend_components');
        expect(compQ.insert).toHaveBeenCalledWith([{ bean_id: 'b1', ratio_pct: 100, blend_id: 'blend-1' }]);
    });

    it('returns get() result after successful insert', async () => {
        const newBlend = { id: 'blend-1', ...blendInsert };
        const full = {
            ...newBlend,
            blend_components: [{ bean_id: 'b1', ratio_pct: 100, beans: { name: 'Brazil' } }],
        };

        const blendQ = chainable({ data: newBlend, error: null });
        const compQ = chainable({ data: null, error: null });
        const getQ = chainable({ data: full, error: null });

        from.mockReturnValueOnce(blendQ).mockReturnValueOnce(compQ).mockReturnValueOnce(getQ);

        await expect(blendApi.create(blendInsert, components)).resolves.toEqual(full);
        expect(from).toHaveBeenNthCalledWith(3, 'blends');
        expect(getQ.select).toHaveBeenCalledWith('*, blend_components(*, beans(name))');
        expect(getQ.eq).toHaveBeenCalledWith('id', 'blend-1');
        expect(getQ.single).toHaveBeenCalled();
    });
});
