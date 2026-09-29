import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => fromMock(...args),
    },
}));

const { resetRoastProfileSourceSelectForTests, roastProfileApi } = await import('./api');

const selects: string[] = [];

function mockList(results: { data: unknown; error: unknown }[]) {
    let call = 0;
    fromMock.mockImplementation(() => {
        const result = results[Math.min(call, results.length - 1)] ?? { data: [], error: null };
        call += 1;
        const terminal = Promise.resolve(result);
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = vi.fn((cols: string) => {
            selects.push(cols);
            return chain;
        });
        chain.eq = vi.fn(self);
        chain.order = vi.fn(self);
        Object.assign(chain, {
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for supabase builder
            then: terminal.then.bind(terminal),
            catch: terminal.catch.bind(terminal),
        });
        return chain;
    });
}

describe('roastProfileApi.list source heater column', () => {
    beforeEach(() => {
        selects.length = 0;
        fromMock.mockReset();
        resetRoastProfileSourceSelectForTests();
    });

    it('keeps heater_events in the source embed when the column exists', async () => {
        mockList([{ data: [{ id: 'p1' }], error: null }]);

        await expect(roastProfileApi.list('owner-1')).resolves.toEqual([{ id: 'p1' }]);

        expect(selects).toHaveLength(1);
        expect(selects[0]).toContain('heater_events');
    });

    it('falls back once when heater_events is missing and does not probe again', async () => {
        const missing = {
            code: '42703',
            message: 'column roast_sessions_1.heater_events does not exist',
            details: null,
            hint: null,
        };
        mockList([
            { data: null, error: missing },
            { data: [{ id: 'p1', name: 'Washed' }], error: null },
            { data: [{ id: 'p1', name: 'Washed' }], error: null },
        ]);

        await expect(roastProfileApi.list('owner-1')).resolves.toEqual([{ id: 'p1', name: 'Washed' }]);
        expect(selects[0]).toContain('heater_events');
        expect(selects[1]).not.toContain('heater_events');

        selects.length = 0;
        await roastProfileApi.list('owner-1');
        expect(selects).toHaveLength(1);
        expect(selects[0]).not.toContain('heater_events');
        expect(fromMock).toHaveBeenCalledTimes(3);
    });

    it('does not swallow a different undefined column', async () => {
        mockList([
            {
                data: null,
                error: { code: '42703', message: 'column roast_sessions_1.events does not exist' },
            },
        ]);

        await expect(roastProfileApi.list('owner-1')).rejects.toMatchObject({ code: '42703' });
        expect(selects).toHaveLength(1);
        expect(selects[0]).toContain('heater_events');
    });
});
