import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock('./list-for-date-range', () => ({ listForDateRange: vi.fn() }));
vi.mock('./materialize', () => ({ materializePlanBatch: vi.fn() }));
vi.mock('./session-counts', () => ({ countSessionsByBatch: vi.fn() }));
vi.mock('./recurrence-rule', () => ({
    recurrenceRuleApi: { get: vi.fn() },
    mergeRecurrenceRuleMaster: (existing: { rrule: string }, patch: { dtstart?: string; bean_name?: string }) => ({
        ...existing,
        ...patch,
    }),
}));

import { planBatchApi } from './plan-batch';
import { recurrenceRuleApi } from './recurrence-rule';

describe('planBatchApi.updateFromThis', () => {
    beforeEach(() => {
        rpc.mockReset();
        vi.mocked(recurrenceRuleApi.get).mockReset();
    });

    it('splits the rule in one RPC', async () => {
        vi.mocked(recurrenceRuleApi.get).mockResolvedValue({
            id: 'rule-1',
            rrule: 'FREQ=WEEKLY',
            dtstart: '2026-07-01',
            user_id: 'owner',
        } as never);
        const created = { id: 'rule-2', rrule: 'FREQ=WEEKLY', dtstart: '2026-07-06' };
        rpc.mockResolvedValue({ data: created, error: null });

        await expect(
            planBatchApi.updateFromThis('rule-1', '2026-07-06', {
                userId: 'owner',
                bean_name: 'Kenya',
            }),
        ).resolves.toEqual(created);

        expect(rpc).toHaveBeenCalledWith('split_recurrence_rule', {
            p_rule_id: 'rule-1',
            p_from_date: '2026-07-06',
            p_rule: expect.objectContaining({
                user_id: 'owner',
                dtstart: '2026-07-06',
                bean_name: 'Kenya',
                status: 'active',
            }),
        });
    });
});
