import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

const { resetRoastProfileSourceSelectForTests, roastProfileApi } = await import('./api');

const page = (count: number, idPrefix: string) =>
    Array.from({ length: count }, (_, index) => ({ id: `${idPrefix}-${index}` }));

describe('profile reference batches', () => {
    beforeEach(() => {
        fromMock.mockReset();
        resetRoastProfileSourceSelectForTests();
    });

    it('loads every completed batch for the profile, past the first page', async () => {
        const selects: string[] = [];
        const filters: [string, unknown][] = [];
        const pages = [page(1000, 'a'), page(1, 'b')];
        fromMock.mockImplementation(() => {
            const chain: Record<string, unknown> = {};
            const self = () => chain;
            chain.select = vi.fn((columns: string) => {
                selects.push(columns);
                return chain;
            });
            chain.eq = vi.fn((column: string, value: unknown) => {
                filters.push([column, value]);
                return chain;
            });
            chain.order = vi.fn(self);
            chain.range = vi.fn(() => Promise.resolve({ data: pages.shift() ?? [], error: null }));
            return chain;
        });

        const rows = await roastProfileApi.referenceBatches('profile-1');

        expect(rows).toHaveLength(1001);
        expect(rows[0]?.id).toBe('a-0');
        expect(rows[1000]?.id).toBe('b-0');
        expect(selects[0]).toContain('profile_batch_number');
        expect(selects[0]).toContain('tsv_path');
        expect(selects[0].split(', ')).not.toContain('events');
        expect(filters).toEqual([
            ['profile_id', 'profile-1'],
            ['status', 'completed'],
            ['profile_id', 'profile-1'],
            ['status', 'completed'],
        ]);
    });

    it('retries without heater_events when that session column is missing', async () => {
        const selects: string[] = [];
        let attempt = 0;
        fromMock.mockImplementation(() => {
            const chain: Record<string, unknown> = {};
            const self = () => chain;
            chain.select = vi.fn((columns: string) => {
                selects.push(columns);
                return chain;
            });
            chain.eq = vi.fn(self);
            chain.order = vi.fn(self);
            chain.range = vi.fn(() => {
                attempt += 1;
                if (attempt === 1) {
                    return Promise.resolve({
                        data: null,
                        error: { code: '42703', message: 'column roast_sessions.heater_events does not exist' },
                    });
                }
                return Promise.resolve({ data: [{ id: 's1' }], error: null });
            });
            return chain;
        });

        await expect(roastProfileApi.referenceBatches('profile-1')).resolves.toEqual([{ id: 's1' }]);
        expect(selects[0]).toContain('heater_events');
        expect(selects[1]).not.toContain('heater_events');
    });

    it('updates only the reference session id', async () => {
        const update = vi.fn();
        fromMock.mockImplementation(() => {
            const chain: Record<string, unknown> = {};
            const self = () => chain;
            chain.update = update.mockImplementation(self);
            chain.eq = vi.fn(self);
            chain.select = vi.fn(self);
            chain.single = vi.fn(() =>
                Promise.resolve({ data: { id: 'profile-1', source_session_id: 's2' }, error: null }),
            );
            return chain;
        });

        await roastProfileApi.setReferenceSession('profile-1', 's2');

        expect(update).toHaveBeenCalledWith({ source_session_id: 's2' });
    });
});
