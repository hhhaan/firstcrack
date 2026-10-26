import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => fromMock(...args),
    },
}));

const { POSTGREST_MAX_ROWS, roastSessionApi } = await import('./api');

const row = (id: string) => ({ id });

function mockPagedSelect(pages: unknown[][]) {
    let call = 0;
    fromMock.mockImplementation(() => {
        const data = pages[call] ?? [];
        call += 1;
        const terminal = Promise.resolve({ data, error: null });
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        for (const k of ['select', 'eq', 'gte', 'order', 'lt', 'lte', 'single']) {
            chain[k] = vi.fn(self);
        }
        chain.range = vi.fn(self);
        Object.assign(chain, {
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for supabase builder
            then: terminal.then.bind(terminal),
            catch: terminal.catch.bind(terminal),
        });
        return chain;
    });
}

describe('roastSessionApi.list', () => {
    beforeEach(() => {
        fromMock.mockReset();
    });

    it('walks PostgREST pages so sessions past max_rows are not dropped', async () => {
        const first = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => row(`new-${i}`));
        const oldestShortest = row('oldest-shortest');
        mockPagedSelect([first, [oldestShortest]]);

        const rows = await roastSessionApi.list('user-1', 'completed');

        expect(rows).toHaveLength(POSTGREST_MAX_ROWS + 1);
        expect(rows[rows.length - 1].id).toBe('oldest-shortest');
        expect(fromMock).toHaveBeenCalledTimes(2);
        const firstRange = fromMock.mock.results[0].value.range as ReturnType<typeof vi.fn>;
        const secondRange = fromMock.mock.results[1].value.range as ReturnType<typeof vi.fn>;
        expect(firstRange).toHaveBeenCalledWith(0, POSTGREST_MAX_ROWS - 1);
        expect(secondRange).toHaveBeenCalledWith(POSTGREST_MAX_ROWS, POSTGREST_MAX_ROWS * 2 - 1);
    });
});

describe('roastSessionApi.listFilterMeta', () => {
    it('includes profiles from every page of completed sessions in the workspace', async () => {
        fromMock.mockReset();
        const first = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => row(`new-${i}`));
        const oldest = {
            roasted_at: '2024-01-01T00:00:00Z',
            profile_id: 'old-profile',
            roast_profiles: { name: 'Old Profile' },
            beans: null,
        };
        mockPagedSelect([first, [oldest]]);

        const rows = await roastSessionApi.listFilterMeta('owner-1');

        expect(rows).toHaveLength(POSTGREST_MAX_ROWS + 1);
        expect(rows[rows.length - 1]).toEqual(oldest);
        expect(fromMock).toHaveBeenCalledTimes(2);
        for (const call of fromMock.mock.results) {
            expect(call.value.select).toHaveBeenCalledWith(
                'roasted_at, profile_id, beans(origin), roast_profiles!profile_id(name)',
            );
            expect(call.value.eq).toHaveBeenCalledWith('user_id', 'owner-1');
            expect(call.value.eq).toHaveBeenCalledWith('status', 'completed');
        }
        expect(fromMock.mock.results[1].value.range).toHaveBeenCalledWith(
            POSTGREST_MAX_ROWS,
            POSTGREST_MAX_ROWS * 2 - 1,
        );
    });
});
