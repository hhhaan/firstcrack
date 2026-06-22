import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BeanStockEventInsert, StockSummary } from './api';
import { beanStockEventApi } from './api';

const applyDelta = (summary: StockSummary, event: BeanStockEventInsert): StockSummary => {
    const affectsCurrent = event.event_type !== 'expected_inbound';
    const nextCurrent = affectsCurrent ? summary.currentGrams + event.delta_grams : summary.currentGrams;
    const nextAvailable = summary.availableGrams + event.delta_grams;
    return {
        currentGrams: nextCurrent,
        availableGrams: nextAvailable,
        reservedGrams: summary.reservedGrams,
        effectiveGrams: nextAvailable - summary.reservedGrams,
    };
};

export const stockEventKeys = {
    byBean: (beanId: string) => ['bean-stock-events', beanId] as const,
    summary: (beanId: string) => ['bean-stock-summary', beanId] as const,
    summariesByUser: (userId: string) => ['bean-stock-summaries', userId] as const,
};

export const useBeanStockEvents = (beanId: string) =>
    useQuery({
        queryKey: stockEventKeys.byBean(beanId),
        queryFn: () => beanStockEventApi.listByBean(beanId),
        enabled: !!beanId,
    });

export const useBeanStockSummary = (beanId: string) =>
    useQuery({
        queryKey: stockEventKeys.summary(beanId),
        queryFn: () => beanStockEventApi.getStockSummary(beanId),
        enabled: !!beanId,
    });

export const useBeanStockSummaries = (userId: string) =>
    useQuery({
        queryKey: stockEventKeys.summariesByUser(userId),
        queryFn: () => beanStockEventApi.getStockSummariesByUser(userId),
        enabled: !!userId,
    });

export const useInsertStockEvent = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: beanStockEventApi.insert,
        onMutate: async (newEvent: BeanStockEventInsert) => {
            const beanId = newEvent.bean_id!;
            await qc.cancelQueries({ queryKey: stockEventKeys.summary(beanId) });
            await qc.cancelQueries({ queryKey: ['bean-stock-summaries'] });

            const prevSummary = qc.getQueryData<StockSummary>(stockEventKeys.summary(beanId));
            const prevSummaries = qc.getQueriesData<Record<string, StockSummary>>({
                queryKey: ['bean-stock-summaries'],
            });

            if (prevSummary) {
                qc.setQueryData<StockSummary>(stockEventKeys.summary(beanId), applyDelta(prevSummary, newEvent));
            }

            qc.setQueriesData<Record<string, StockSummary>>({ queryKey: ['bean-stock-summaries'] }, (prev) => {
                if (!prev?.[beanId]) return prev;
                return { ...prev, [beanId]: applyDelta(prev[beanId], newEvent) };
            });

            return { prevSummary, prevSummaries };
        },
        onError: (_err, newEvent, ctx) => {
            const beanId = newEvent.bean_id!;
            if (ctx?.prevSummary) qc.setQueryData(stockEventKeys.summary(beanId), ctx.prevSummary);
            if (ctx?.prevSummaries) {
                for (const [queryKey, data] of ctx.prevSummaries) qc.setQueryData(queryKey, data);
            }
        },
        onSettled: async (_data, _err, newEvent: BeanStockEventInsert) => {
            const beanId = newEvent.bean_id!;
            qc.invalidateQueries({ queryKey: stockEventKeys.byBean(beanId) });
            qc.invalidateQueries({ queryKey: stockEventKeys.summary(beanId) });
            qc.invalidateQueries({ queryKey: ['bean-stock-summaries'] });
            qc.invalidateQueries({ queryKey: ['inventory-alerts'] });
            if (newEvent.user_id) {
                await beanStockEventApi.computeInventoryAlerts(newEvent.user_id);
                qc.invalidateQueries({ queryKey: ['inventory-alerts'] });
                qc.invalidateQueries({ queryKey: ['dashboard', newEvent.user_id] });
            }
        },
    });
};
