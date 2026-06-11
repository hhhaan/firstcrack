import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { beanStockEventApi } from './api';
import type { BeanStockEvent } from './api';

export const stockEventKeys = {
  byBean: (beanId: string) => ['bean-stock-events', beanId] as const,
  summary: (beanId: string) => ['bean-stock-summary', beanId] as const,
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

export const useInsertStockEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: beanStockEventApi.insert,
    onSuccess: (event: BeanStockEvent) => {
      qc.invalidateQueries({ queryKey: stockEventKeys.byBean(event.bean_id) });
      qc.invalidateQueries({ queryKey: stockEventKeys.summary(event.bean_id) });
    },
  });
};
