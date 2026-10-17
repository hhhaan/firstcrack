import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => fromMock(...args),
    },
}));

vi.mock('@shared/lib/inventoryStore', () => ({
    inventoryStore: { getHorizonDays: vi.fn().mockResolvedValue(28) },
}));

const { PURCHASE_COST_PAGE_SIZE, beanStockEventApi } = await import('./api');

function mockPagedSelect(pages: unknown[][]) {
    let call = 0;
    fromMock.mockImplementation(() => {
        const data = pages[call] ?? [];
        call += 1;
        const terminal = Promise.resolve({ data, error: null });
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        for (const k of ['select', 'eq', 'not', 'gt', 'order', 'limit']) {
            chain[k] = vi.fn(self);
        }
        Object.assign(chain, {
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for supabase builder
            then: terminal.then.bind(terminal),
            catch: terminal.catch.bind(terminal),
        });
        return chain;
    });
}

describe('beanStockEventApi.listPurchaseCostsByUser', () => {
    beforeEach(() => {
        fromMock.mockReset();
    });

    it('walks pages past PostgREST max_rows', async () => {
        const first = Array.from({ length: PURCHASE_COST_PAGE_SIZE }, (_, i) => ({
            id: `id-${i}`,
            bean_id: 'b1',
            delta_grams: 100,
            cost_per_kg: 10_000 + i,
        }));
        const second = [{ id: 'id-last', bean_id: 'b1', delta_grams: 50, cost_per_kg: 12_000 }];
        mockPagedSelect([first, second]);

        const rows = await beanStockEventApi.listPurchaseCostsByUser('user-1');

        expect(rows).toHaveLength(PURCHASE_COST_PAGE_SIZE + 1);
        expect(fromMock).toHaveBeenCalledTimes(2);
        const secondGt = fromMock.mock.results[1].value.gt as ReturnType<typeof vi.fn>;
        expect(secondGt).toHaveBeenCalledWith('id', `id-${PURCHASE_COST_PAGE_SIZE - 1}`);
    });

    it('throws on page error without partial data', async () => {
        let call = 0;
        const fullPage = Array.from({ length: PURCHASE_COST_PAGE_SIZE }, (_, i) => ({
            id: `id-${i}`,
            bean_id: 'b1',
            delta_grams: 1,
            cost_per_kg: 1,
        }));
        fromMock.mockImplementation(() => {
            call += 1;
            const terminal =
                call === 1
                    ? Promise.resolve({ data: fullPage, error: null })
                    : Promise.resolve({ data: null, error: { message: 'fail' } });
            const chain: Record<string, unknown> = {};
            const self = () => chain;
            for (const k of ['select', 'eq', 'not', 'gt', 'order', 'limit']) chain[k] = vi.fn(self);
            Object.assign(chain, {
                // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock
                then: terminal.then.bind(terminal),
                catch: terminal.catch.bind(terminal),
            });
            return chain;
        });

        await expect(beanStockEventApi.listPurchaseCostsByUser('user-1')).rejects.toEqual({ message: 'fail' });
    });
});
