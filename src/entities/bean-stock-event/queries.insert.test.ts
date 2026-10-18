import { beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn();
const computeInventoryAlerts = vi.fn();

vi.mock('./api', () => ({
    beanStockEventApi: {
        insert,
        computeInventoryAlerts,
    },
}));

const { insertStockEventWithAlerts } = await import('./queries');

describe('insertStockEventWithAlerts', () => {
    beforeEach(() => {
        insert.mockReset();
        computeInventoryAlerts.mockReset();
        insert.mockResolvedValue({ id: 'ev-1' });
    });

    it('returns alertsFailed when insert succeeds but alert RPC fails', async () => {
        computeInventoryAlerts.mockRejectedValue(new Error('alerts down'));
        const result = await insertStockEventWithAlerts({
            user_id: 'u1',
            bean_id: 'b1',
            delta_grams: 1000,
            event_type: 'purchase',
            reference_id: 'ref-1',
        });
        expect(insert).toHaveBeenCalled();
        expect(result).toEqual({ row: { id: 'ev-1' }, alertsFailed: true });
    });
});
