import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryChain = {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
};

const from = vi.fn();
const rpc = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
        rpc: (...args: unknown[]) => rpc(...args),
    },
}));

import { blendApi, blendWriteErrorMessage } from './api';

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

const postgrestError = (message: string, details = '') => ({ code: 'P0001', details, hint: null, message });

describe('blendWriteErrorMessage', () => {
    it('maps duplicate-bean failures to the form copy', () => {
        expect(blendWriteErrorMessage(postgrestError('blend_duplicate_bean'))).toBe(
            '같은 생두를 중복으로 선택할 수 없습니다',
        );
        expect(
            blendWriteErrorMessage(
                postgrestError('duplicate key value violates unique constraint "unique_bean_per_blend"'),
            ),
        ).toBe('같은 생두를 중복으로 선택할 수 없습니다');
        expect(blendWriteErrorMessage(new Error('같은 생두를 중복으로 선택할 수 없습니다'))).toBe(
            '같은 생두를 중복으로 선택할 수 없습니다',
        );
    });

    it('maps ratio failures, including the deferred trigger text', () => {
        expect(blendWriteErrorMessage(postgrestError('blend_ratio_sum'))).toBe('구성 비율 합계가 100%여야 합니다');
        expect(blendWriteErrorMessage({ message: 'blend_components ratio_pct must sum to 100 (got 80)' })).toBe(
            '구성 비율 합계가 100%여야 합니다',
        );
    });

    it('leaves unrelated failures unmapped', () => {
        expect(blendWriteErrorMessage(postgrestError('workspace access denied'))).toBeNull();
        expect(blendWriteErrorMessage(null)).toBeNull();
    });
});

describe('blendApi.create', () => {
    beforeEach(() => {
        from.mockReset();
        rpc.mockReset();
    });

    it('throws the mapped message when save_blend rejects a duplicate and does not read the blend back', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: postgrestError('blend_duplicate_bean') });

        await expect(blendApi.create(blendInsert, components)).rejects.toThrow(
            '같은 생두를 중복으로 선택할 수 없습니다',
        );
        expect(rpc).toHaveBeenCalledWith('save_blend', {
            p_user_id: 'u1',
            p_name: 'House',
            p_description: '',
            p_components: [{ bean_id: 'b1', ratio_pct: 100 }],
        });
        expect(from).not.toHaveBeenCalled();
    });

    it('rethrows an unmapped save error unchanged', async () => {
        const err = postgrestError('workspace access denied');
        rpc.mockResolvedValueOnce({ data: null, error: err });

        await expect(blendApi.create(blendInsert, components)).rejects.toBe(err);
        expect(from).not.toHaveBeenCalled();
    });

    it('returns get() after a successful atomic save', async () => {
        const full = {
            id: 'blend-1',
            ...blendInsert,
            blend_components: [{ bean_id: 'b1', ratio_pct: 100, beans: { name: 'Brazil' } }],
        };
        rpc.mockResolvedValueOnce({ data: 'blend-1', error: null });
        const getQ = chainable({ data: full, error: null });
        from.mockReturnValueOnce(getQ);

        await expect(blendApi.create(blendInsert, components)).resolves.toEqual(full);
        expect(from).toHaveBeenCalledTimes(1);
        expect(from).toHaveBeenCalledWith('blends');
        expect(getQ.select).toHaveBeenCalledWith('*, blend_components(*, beans(name))');
        expect(getQ.eq).toHaveBeenCalledWith('id', 'blend-1');
        expect(getQ.single).toHaveBeenCalled();
    });
});

describe('blendApi.update', () => {
    beforeEach(() => {
        from.mockReset();
        rpc.mockReset();
    });

    it('sends header and components in one save_blend call', async () => {
        const full = { id: 'blend-1', ...blendInsert, blend_components: [] };
        rpc.mockResolvedValueOnce({ data: 'blend-1', error: null });
        from.mockReturnValueOnce(chainable({ data: full, error: null }));

        await blendApi.update('blend-1', { name: 'House 2', description: 'notes' }, [
            { bean_id: 'b1', ratio_pct: 40 },
            { bean_id: 'b2', ratio_pct: 60 },
        ]);

        expect(rpc).toHaveBeenCalledWith('save_blend', {
            p_id: 'blend-1',
            p_name: 'House 2',
            p_description: 'notes',
            p_components: [
                { bean_id: 'b1', ratio_pct: 40 },
                { bean_id: 'b2', ratio_pct: 60 },
            ],
        });
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('maps a ratio failure and does not read the blend back', async () => {
        rpc.mockResolvedValueOnce({
            data: null,
            error: postgrestError('blend_components ratio_pct must sum to 100 (got 80)'),
        });

        await expect(
            blendApi.update('blend-1', { name: 'House' }, [
                { bean_id: 'b1', ratio_pct: 40 },
                { bean_id: 'b2', ratio_pct: 40 },
            ]),
        ).rejects.toThrow('구성 비율 합계가 100%여야 합니다');
        expect(from).not.toHaveBeenCalled();
    });
});
