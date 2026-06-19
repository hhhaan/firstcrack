import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BeanStockEvent } from './api';
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
        onSuccess: (event: BeanStockEvent) => {
            qc.invalidateQueries({ queryKey: stockEventKeys.byBean(event.bean_id) });
            qc.invalidateQueries({ queryKey: stockEventKeys.summary(event.bean_id) });
            qc.invalidateQueries({ queryKey: ['bean-stock-summaries'] });
        },
    });
};
