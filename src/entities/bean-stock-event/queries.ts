import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BeanStockEventInsert, StockSummary } from './api';
import { beanStockEventApi } from './api';

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
                const next = prevSummary.currentGrams + newEvent.delta_grams;
                qc.setQueryData<StockSummary>(stockEventKeys.summary(beanId), {
                    ...prevSummary,
                    currentGrams: next,
                    effectiveGrams: next - prevSummary.reservedGrams,
                });
            }

            qc.setQueriesData<Record<string, StockSummary>>({ queryKey: ['bean-stock-summaries'] }, (prev) => {
                if (!prev?.[beanId]) return prev;
                const old = prev[beanId];
                const next = old.currentGrams + newEvent.delta_grams;
                return { ...prev, [beanId]: { ...old, currentGrams: next, effectiveGrams: next - old.reservedGrams } };
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
        onSettled: (_data, _err, newEvent: BeanStockEventInsert) => {
            const beanId = newEvent.bean_id!;
            qc.invalidateQueries({ queryKey: stockEventKeys.byBean(beanId) });
            qc.invalidateQueries({ queryKey: stockEventKeys.summary(beanId) });
            qc.invalidateQueries({ queryKey: ['bean-stock-summaries'] });
        },
    });
};
