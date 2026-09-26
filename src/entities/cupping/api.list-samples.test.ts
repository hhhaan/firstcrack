import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

import { cuppingApi } from './api';

/**
 * Session `fd`: list select `id, event_id` sees 3 samples and 1 score.
 * The detail used to select `*, roast_sessions(...beans...)`. That nested embed
 * can come back empty (RLS / inner-join on the roast or bean) while the plain
 * sample read still returns the rows — detail then shows 0 samples.
 */
const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const samples = [
    {
        id: 's1',
        event_id: EVENT_ID,
        user_id: USER_ID,
        label: 'A',
        roast_session_id: null,
        sort_order: 0,
        created_at: '2026-09-01T00:00:00.000Z',
    },
    {
        id: 's2',
        event_id: EVENT_ID,
        user_id: USER_ID,
        label: 'B',
        roast_session_id: 'roast-1',
        sort_order: 1,
        created_at: '2026-09-01T00:00:01.000Z',
    },
    {
        id: 's3',
        event_id: EVENT_ID,
        user_id: USER_ID,
        label: 'C',
        roast_session_id: null,
        sort_order: 2,
        created_at: '2026-09-01T00:00:02.000Z',
    },
];

const event = {
    id: EVENT_ID,
    user_id: USER_ID,
    title: 'fd',
    held_at: '2026-09-01T00:00:00.000Z',
    notes: null,
    ended_at: '2026-09-02T00:00:00.000Z',
    results_token: null,
    form_template_id: null,
    form_snapshot: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
};

type Result = { data: unknown; error: unknown };

function builder(getResult: (select: string) => Result, onEq?: (col: string, val: unknown) => void) {
    let select = '';
    let resolveResult: (value: Result) => void = () => {};
    const q = new Promise<Result>((resolve) => {
        resolveResult = resolve;
    }) as Promise<Result> & Record<string, ReturnType<typeof vi.fn>>;
    const chain = () => q;
    for (const m of ['in', 'order', 'is', 'gt']) {
        q[m] = vi.fn(chain);
    }
    q.eq = vi.fn((col: string, val: unknown) => {
        onEq?.(col, val);
        return q;
    });
    // select() runs before await, so the result can depend on the column list.
    q.select = vi.fn((cols: string) => {
        select = cols;
        resolveResult(getResult(select));
        return q;
    });
    return q;
}

describe('cupping list vs detail sample read', () => {
    const sampleFilters: { col: string; val: unknown }[] = [];

    beforeEach(() => {
        from.mockReset();
        sampleFilters.length = 0;
        from.mockImplementation((table: string) => {
            if (table === 'cupping_samples') {
                return builder(
                    (select) => {
                        // Nested roast/bean embed drops the parent rows. Plain select does not.
                        if (select.includes('roast_sessions(')) return { data: [], error: null };
                        return { data: samples, error: null };
                    },
                    (col, val) => sampleFilters.push({ col, val }),
                );
            }
            if (table === 'cuppings') {
                return builder(() => ({
                    data: [{ sample_id: 's1', total_score: 84, cupped_by: 'Ada' }],
                    error: null,
                }));
            }
            if (table === 'cupping_events') {
                return builder(() => ({ data: [event], error: null }));
            }
            if (table === 'cupping_invites') {
                return builder(() => ({ data: [], error: null }));
            }
            if (table === 'roast_sessions') {
                return builder((select) => {
                    if (select.includes('beans(')) return { data: [], error: null };
                    return {
                        data: [{ id: 'roast-1', roasted_at: '2026-09-01T00:00:00.000Z' }],
                        error: null,
                    };
                });
            }
            return builder(() => ({ data: [], error: null }));
        });
    });

    it('detail samples match the list aggregate when the roast embed is empty', async () => {
        const [summary] = await cuppingApi.listEvents(USER_ID);
        expect(summary.sample_count).toBe(3);
        expect(summary.participant_count).toBe(1);
        expect(summary.score_count).toBe(1);
        expect(summary.avg_score).toBe(84);

        const detail = await cuppingApi.listSamples(EVENT_ID);
        expect(detail).toHaveLength(3);
        expect(detail.map((s) => s.label)).toEqual(['A', 'B', 'C']);
        expect(sampleFilters).toContainEqual({ col: 'event_id', val: EVENT_ID });

        const scored = detail.find((s) => s.id === 's1');
        expect(scored?.score_count).toBe(1);
        expect(scored?.avg_score).toBe(84);
        expect(detail.find((s) => s.id === 's2')?.score_count).toBe(0);
    });
});
