// @vitest-environment jsdom
import { beanStockEventApi } from '@entities/bean-stock-event/api';
import { useBeanStockEvents, useBeanStockSummary } from '@entities/bean-stock-event/queries';
import { isOptimisticId } from '@shared/lib/optimistic-id';
import type { Bean } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beanApi } from './api';
import { useOptimisticBeanSelection } from './model/useOptimisticBeanSelection';
import { useBeans, useCreateBean } from './queries';

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: () => {
            throw new Error('supabase.from');
        },
        rpc: () => {
            throw new Error('supabase.rpc');
        },
    },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = 'user-1';
const REAL = '11111111-1111-4111-8111-111111111111';

const realBean = (): Bean =>
    ({
        id: REAL,
        user_id: USER,
        name: 'Yirg',
        capacity_grams: 0,
        low_stock_threshold_grams: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        altitude_masl: null,
        cost_per_kg: null,
        farm: null,
        origin: null,
        process: null,
        purchase_date: null,
        region: null,
        tasting_notes: null,
        variety: null,
        vendor: null,
    }) satisfies Bean;

type Latest = {
    beans: Bean[];
    selected: string | null;
    setSelected: (id: string) => void;
    mutate: (input: { user_id: string; name: string }) => void;
};

describe('create bean replaces the optimistic id', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let latest!: Latest;
    let resolveCreate: (bean: Bean) => void;
    const stockCalls: string[] = [];

    const flush = async () => {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    };

    function Probe() {
        const beans = useBeans(USER);
        const create = useCreateBean(USER);
        const [selected, setSelected] = useState<string | null>(null);
        useOptimisticBeanSelection(selected, setSelected);
        useBeanStockSummary(selected ?? '');
        useBeanStockEvents(selected ?? '');
        latest = {
            beans: beans.data ?? [],
            selected,
            setSelected,
            mutate: (input) => {
                create.mutate(input);
            },
        };
        return null;
    }

    beforeEach(() => {
        stockCalls.length = 0;
        qc = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
        });
        root = createRoot(document.createElement('div'));
        vi.spyOn(beanApi, 'list').mockResolvedValue([]);
        vi.spyOn(beanApi, 'create').mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveCreate = resolve;
                }),
        );
        vi.spyOn(beanStockEventApi, 'listByBean').mockImplementation(async (id) => {
            stockCalls.push(id);
            if (isOptimisticId(id)) throw new Error(`listByBean ${id}`);
            return [];
        });
        vi.spyOn(beanStockEventApi, 'getStockSummary').mockImplementation(async (id) => {
            stockCalls.push(id);
            if (isOptimisticId(id)) throw new Error(`getStockSummary ${id}`);
            return { currentGrams: 1, availableGrams: 1, reservedGrams: 0, effectiveGrams: 1 };
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.restoreAllMocks();
    });

    const mount = async () => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });
        await flush();
    };

    const selectOptimistic = async () => {
        await mount();
        act(() => latest.mutate({ user_id: USER, name: 'Yirg' }));
        await flush();
        const tempId = latest.beans[0]?.id;
        expect(tempId && isOptimisticId(tempId)).toBe(true);
        act(() => latest.setSelected(tempId));
        await flush();
        expect(stockCalls).toEqual([]);
        return tempId;
    };

    it('swaps the cache and the selection to the server uuid', async () => {
        const tempId = await selectOptimistic();
        await act(async () => {
            resolveCreate(realBean());
        });
        await flush();
        expect(latest.beans.map((bean) => bean.id)).toEqual([REAL]);
        expect(latest.selected).toBe(REAL);
        expect(latest.selected).not.toBe(tempId);
        expect(stockCalls.every((id) => id === REAL)).toBe(true);
        expect(stockCalls.length).toBeGreaterThan(0);
    });

    it('still publishes the real id when the optimistic row was wiped before success', async () => {
        await selectOptimistic();
        act(() => {
            qc.setQueryData<Bean[]>(['beans', USER], []);
        });
        await flush();
        expect(stockCalls).toEqual([]);
        await act(async () => {
            resolveCreate(realBean());
        });
        await flush();
        expect(latest.beans.map((bean) => bean.id)).toEqual([REAL]);
        expect(latest.selected).toBe(REAL);
        expect(stockCalls.every((id) => !isOptimisticId(id))).toBe(true);
    });
});
