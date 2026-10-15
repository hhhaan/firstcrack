// @vitest-environment jsdom
import { beanStockEventApi, type StockSummary, stockEventKeys } from '@entities/bean-stock-event';
import type { BlendWithComponents } from '@entities/blend';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddBatchModal } from './AddBatchModal';
import type { BatchFormHeader } from './BatchFormHeader';
import type { BatchQuantityFields } from './BatchQuantityFields';
import type { BatchSourceFields } from './BatchSourceFields';
import type { BatchStockPanel } from './BatchStockPanel';
import type { BatchTypeTabs } from './BatchTypeTabs';

const state = vi.hoisted(() => ({
    ownerId: 'owner',
    componentCount: 1,
    source: undefined as Parameters<typeof BatchSourceFields>[0] | undefined,
    panel: undefined as Parameters<typeof BatchStockPanel>[0] | undefined,
    tabs: undefined as Parameters<typeof BatchTypeTabs>[0] | undefined,
    quantity: undefined as Parameters<typeof BatchQuantityFields>[0] | undefined,
    header: undefined as Parameters<typeof BatchFormHeader>[0] | undefined,
}));

vi.mock('@entities/bean-stock-event/api', () => ({
    beanStockEventApi: { getStockSummariesByUser: vi.fn(), getStockSummary: vi.fn() },
}));
vi.mock('@entities/bean/queries', () => ({ useBeans: () => ({ data: [{ id: 'bean-0', name: 'Bean' }] }) }));
vi.mock('@entities/blend', () => ({
    useBlends: () => ({
        data: [
            {
                id: 'blend',
                name: 'Blend',
                blend_components: Array.from({ length: state.componentCount }, (_, i) => ({
                    bean_id: `bean-${i}`,
                    ratio_pct: 100 / state.componentCount,
                    beans: { name: `Bean ${i}` },
                })),
            } as BlendWithComponents,
        ],
    }),
}));
vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: state.ownerId }) }));
vi.mock('@entities/machine', () => ({ useMachines: () => ({ machines: [] }) }));
vi.mock('@entities/profile', () => ({ useProfile: () => ({}) }));
vi.mock('@entities/roast-profile/queries', () => ({ useRoastProfiles: () => ({ data: [] }) }));
vi.mock('@shared/lib/useFormEscape', () => ({ useFormEscape: vi.fn() }));
vi.mock('./useBatchFormReset', () => ({ useBatchFormReset: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./BatchSourceFields', () => ({
    BatchSourceFields: (props: Parameters<typeof BatchSourceFields>[0]) => {
        state.source = props;
        return null;
    },
}));
vi.mock('./BatchStockPanel', () => ({
    BatchStockPanel: (props: Parameters<typeof BatchStockPanel>[0]) => {
        state.panel = props;
        return null;
    },
}));
vi.mock('./BatchTypeTabs', () => ({
    BatchTypeTabs: (props: Parameters<typeof BatchTypeTabs>[0]) => {
        state.tabs = props;
        return null;
    },
}));
vi.mock('./BatchQuantityFields', () => ({
    BatchQuantityFields: (props: Parameters<typeof BatchQuantityFields>[0]) => {
        state.quantity = props;
        return null;
    },
}));
vi.mock('./BatchFormHeader', () => ({
    BatchFormHeader: (props: Parameters<typeof BatchFormHeader>[0]) => {
        state.header = props;
        return null;
    },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = (effectiveGrams: number): StockSummary => ({
    currentGrams: effectiveGrams,
    availableGrams: effectiveGrams,
    reservedGrams: 0,
    effectiveGrams,
});

describe('AddBatchModal shared stock query', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;
    const flush = async () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    const render = async () => {
        await act(async () =>
            root.render(
                <QueryClientProvider client={qc}>
                    <AddBatchModal open onClose={() => {}} />
                </QueryClientProvider>,
            ),
        );
        await flush();
    };
    beforeEach(() => {
        state.ownerId = 'owner';
        state.source = undefined;
        state.panel = undefined;
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        root = createRoot(document.createElement('div'));
        vi.mocked(beanStockEventApi.getStockSummary).mockReset();
        vi.mocked(beanStockEventApi.getStockSummariesByUser)
            .mockReset()
            .mockResolvedValue({ 'bean-0': summary(1000) });
    });
    afterEach(() => {
        act(() => root.unmount());
        qc.clear();
    });

    it('requires the selected batch type source before enabling submit', async () => {
        await render();
        act(() => {
            state.header?.onDateChange(new Date(2026, 9, 15));
            state.header?.onMachineSelect('machine-1');
            state.quantity?.onTargetRoastedChange('1');
        });
        const submit = [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'addBatchModal.addBatch',
        );
        expect(submit?.disabled).toBe(true);
        act(() => state.source?.onBeanSelect('bean-0'));
        expect(submit?.disabled).toBe(false);
        act(() => state.tabs?.onBatchTypeChange('Pre-roast Blend'));
        expect(submit?.disabled).toBe(true);
        act(() => state.source?.onBlendSelect('blend'));
        expect(submit?.disabled).toBe(false);
        act(() => state.tabs?.onBatchTypeChange('Post-roast Blend'));
        expect(submit?.disabled).toBe(false);
        act(() => state.source?.onBlendSelect(null));
        expect(submit?.disabled).toBe(true);
    });

    it.each([1, 3, 10])(
        'uses one summary query for %i blend components and Single Origin selections',
        async (count) => {
            state.componentCount = count;
            await render();
            act(() => {
                state.source?.onBeanSelect('bean-0');
                state.quantity?.onTargetRoastedChange('1');
            });
            expect(state.source?.stockSummaryEffectiveGrams).toBe(1000);
            act(() => {
                state.source?.onBlendSelect('blend');
                state.tabs?.onBatchTypeChange('Pre-roast Blend');
            });
            expect(state.source?.stockChecks.blendShortages).toHaveLength(count);
            expect(state.source?.stockChecks.blendShortages[0].isShort).toBe(true);
            expect(state.source?.stockChecks.blendShortages.slice(1).every((s) => !s.isShort)).toBe(true);
            act(() => state.tabs?.onBatchTypeChange('Post-roast Blend'));
            expect(state.source?.stockChecks.blendShortages).toHaveLength(count);
            expect(beanStockEventApi.getStockSummariesByUser).toHaveBeenCalledTimes(1);
            expect(beanStockEventApi.getStockSummary).not.toHaveBeenCalled();
        },
    );

    it('does not confirm zero stock or shortage while loading, on failure, or for missing beans', async () => {
        vi.mocked(beanStockEventApi.getStockSummariesByUser).mockImplementation(() => new Promise(() => {}));
        await render();
        act(() => {
            state.source?.onBeanSelect('bean-0');
            state.quantity?.onTargetRoastedChange('1');
        });
        expect(state.source?.stockSummaryEffectiveGrams).toBeUndefined();
        expect(state.source?.stockChecks.isShortage).toBe(false);
        expect(state.panel?.selectedBean).toBeUndefined();
        await act(async () => {
            qc.setQueryData(stockEventKeys.summariesByUser('owner'), {});
        });
        await flush();
        expect(state.panel?.selectedBean).toBeUndefined();
        vi.mocked(beanStockEventApi.getStockSummariesByUser).mockRejectedValue(new Error('unavailable'));
        await act(async () => {
            await qc.invalidateQueries({ queryKey: stockEventKeys.summariesRoot });
        });
        await flush();
        expect(state.source?.stockChecks.isShortage).toBe(false);
    });

    it('updates selections after stock invalidation and isolates workspace caches', async () => {
        await render();
        act(() => state.source?.onBeanSelect('bean-0'));
        vi.mocked(beanStockEventApi.getStockSummariesByUser).mockResolvedValue({ 'bean-0': summary(2000) });
        await act(async () => {
            await qc.invalidateQueries({ queryKey: stockEventKeys.summariesRoot });
        });
        await flush();
        expect(state.source?.stockSummaryEffectiveGrams).toBe(2000);
        state.ownerId = 'other';
        vi.mocked(beanStockEventApi.getStockSummariesByUser).mockResolvedValue({});
        await render();
        expect(state.source?.stockSummaryEffectiveGrams).toBeUndefined();
        expect(state.panel?.selectedBean).toBeUndefined();
        expect(beanStockEventApi.getStockSummariesByUser).toHaveBeenLastCalledWith('other');
        expect(beanStockEventApi.getStockSummary).not.toHaveBeenCalled();
    });
});
