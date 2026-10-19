import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROASTED_HISTORY_LIMIT, roastedStockEventApi } from './api';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@shared/lib/supabase', () => ({ supabase: { from: mocks.from } }));

describe('roasted lot history', () => {
    beforeEach(() => mocks.from.mockReset());

    it.each(['bean', 'blend'] as const)('filters %s before taking the latest 20 plus one', async (kind) => {
        const rows = Array.from({ length: 201 }, (_, i) => ({
            id: `event-${i}`,
            user_id: 'owner',
            bean_id: i === 0 ? 'quiet' : 'busy',
            blend_id: i === 0 ? 'quiet' : 'busy',
        }));
        let filtered = rows;
        const eq = vi.fn((column: keyof (typeof rows)[number], value: string) => {
            filtered = filtered.filter((row) => row[column] === value);
            return chain;
        });
        const chain = {
            select: vi.fn(() => chain),
            eq,
            order: vi.fn(() => chain),
            limit: vi.fn(async (limit: number) => ({ data: filtered.slice(0, limit), error: null })),
        };
        mocks.from.mockReturnValue(chain);
        const events = await roastedStockEventApi.listByLot('owner', { kind, id: 'quiet' });
        expect(events).toEqual([rows[0]]);
        expect(eq).toHaveBeenCalledWith('user_id', 'owner');
        expect(eq).toHaveBeenCalledWith(`${kind}_id`, 'quiet');
        expect(chain.limit).toHaveBeenCalledWith(ROASTED_HISTORY_LIMIT + 1);
    });
});
