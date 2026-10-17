/** @vitest-environment jsdom */
import type { Bean } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const computeInventoryAlerts = vi.fn();

vi.mock('@entities/bean/queries', () => ({
    useCreateBean: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateBean: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

vi.mock('@entities/bean-stock-event', () => ({
    beanStockEventApi: { computeInventoryAlerts },
    stockEventContentKey: (e: { user_id: string; bean_id: string; delta_grams: number; event_type: string }) =>
        `${e.user_id}|${e.bean_id}|${e.delta_grams}|${e.event_type}`,
    useInsertStockEvent: () => ({ mutateAsync: insertMutateAsync, isPending: false }),
}));

const { useAddBeanSubmit } = await import('./useAddBeanSubmit');

const bean: Bean = {
    id: 'bean-1',
    user_id: 'user-1',
    name: 'Test',
    cost_per_kg: 10000,
} as Bean;

const renderSubmit = (over: Partial<Parameters<typeof useAddBeanSubmit>[0]> = {}) => {
    const api: { current: ReturnType<typeof useAddBeanSubmit> | null } = { current: null };
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const root = createRoot(document.createElement('div'));
    const props = {
        open: true,
        userId: 'user-1',
        tab: 'restock' as const,
        selectedBeanId: 'bean-1',
        restockAmount: '10',
        restockCost: '12000',
        adjustType: 'adjustment' as const,
        adjustSign: '+' as const,
        adjustAmount: '',
        adjustNote: '',
        existingBeans: [bean],
        initialData: null,
        onSuccess,
        onClose,
        ...over,
    };
    const Probe = () => {
        api.current = useAddBeanSubmit(props);
        return null;
    };
    act(() => root.render(createElement(Probe)));
    return { api, onSuccess, onClose, root, props };
};

describe('useAddBeanSubmit', () => {
    beforeEach(() => {
        insertMutateAsync.mockReset();
        updateMutateAsync.mockReset();
        computeInventoryAlerts.mockReset();
        insertMutateAsync.mockResolvedValue({ row: {}, alertsFailed: false });
        updateMutateAsync.mockResolvedValue(bean);
    });

    it('on alert refresh failure still updates cost, onSuccess, and blocks resubmit', async () => {
        insertMutateAsync.mockResolvedValue({ row: {}, alertsFailed: true });
        const { api, onSuccess, onClose } = renderSubmit();

        await act(async () => {
            await api.current?.handleSubmit({} as never);
        });

        expect(updateMutateAsync).toHaveBeenCalledWith({ id: 'bean-1', cost_per_kg: 12000 });
        expect(onSuccess).toHaveBeenCalledWith(bean);
        expect(onClose).not.toHaveBeenCalled();
        expect(api.current?.alertsFailed).toBe(true);
        expect(api.current?.stockSaved).toBe(true);

        insertMutateAsync.mockClear();
        await act(async () => {
            await api.current?.handleSubmit({} as never);
        });
        expect(insertMutateAsync).not.toHaveBeenCalled();
    });

    it('retryAlerts only refreshes alerts', async () => {
        insertMutateAsync.mockResolvedValue({ row: {}, alertsFailed: true });
        const { api, onClose } = renderSubmit();
        await act(async () => {
            await api.current?.handleSubmit({} as never);
        });
        computeInventoryAlerts.mockResolvedValue(undefined);
        await act(async () => {
            await api.current?.retryAlerts();
        });
        expect(computeInventoryAlerts).toHaveBeenCalledWith('user-1');
        expect(onClose).not.toHaveBeenCalled();
        expect(api.current?.alertsFailed).toBe(false);
    });
});
