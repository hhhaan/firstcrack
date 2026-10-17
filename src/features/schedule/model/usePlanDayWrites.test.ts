/** @vitest-environment jsdom */
import { invalidatePlanScope, planBatchApi } from '@entities/plan';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidatePlanBatchStock } from './invalidatePlanBatchStock';
import { usePlanDayWrites } from './usePlanDayWrites';

vi.mock('@entities/plan', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/plan')>();
    return {
        ...actual,
        planBatchApi: {
            ...actual.planBatchApi,
            completePlanBatch: vi.fn().mockResolvedValue({}),
            resolveForRoast: vi.fn().mockImplementation(async () => batch),
        },
        invalidatePlanScope: vi.fn(),
        planKeys: actual.planKeys,
    };
});

vi.mock('./invalidatePlanBatchStock', () => ({
    invalidatePlanBatchStock: vi.fn(),
}));

const batch = {
    id: 'pb-1',
    plan_id: 'plan-1',
    bean_id: 'bean-1',
    blend_id: null,
    bean_name: 'Ethiopia',
    batch_size_kg: 1,
    batch_count: 1,
    completed_sessions: 0,
    recurrence_rule_id: null,
} as PlanBatchWithProgress;

function renderWritesHook(): { api: ReturnType<typeof usePlanDayWrites>; cleanup: () => void } {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const holder: { api?: ReturnType<typeof usePlanDayWrites> } = {};
    const Probe = () => {
        holder.api = usePlanDayWrites({ userId: 'user-1', dateKey: '2026-01-01', planId: 'plan-1', batches: [batch] });
        return null;
    };
    const rootEl = document.createElement('div');
    document.body.appendChild(rootEl);
    const root = createRoot(rootEl);
    act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe))));
    if (!holder.api) throw new Error('hook not mounted');
    return { api: holder.api, cleanup: () => root.unmount() };
}

describe('usePlanDayWrites completePlanBatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('invalidates plan scope and stock caches after complete', async () => {
        const { api, cleanup } = renderWritesHook();
        await act(async () => {
            await api.completeBatch(batch, true, { notify: vi.fn() });
        });
        cleanup();
        expect(planBatchApi.completePlanBatch).toHaveBeenCalled();
        expect(invalidatePlanScope).toHaveBeenCalled();
        expect(invalidatePlanBatchStock).toHaveBeenCalledWith(expect.any(QueryClient), 'user-1', ['bean-1'], false);
    });
});
