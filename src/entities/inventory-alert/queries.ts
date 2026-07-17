import { beanStockEventApi } from '@entities/bean-stock-event';
import { dashboardKeys, inventoryQueryRoots } from '@shared/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryAlertApi } from './api';

export const inventoryAlertKeys = {
    all: inventoryQueryRoots.inventoryAlerts,
    list: (userId: string) => [...inventoryQueryRoots.inventoryAlerts, userId] as const,
};

export const useInventoryAlerts = (userId: string) =>
    useQuery({
        queryKey: inventoryAlertKeys.list(userId),
        queryFn: () => inventoryAlertApi.listActive(userId),
        enabled: !!userId,
    });

export const useDismissInventoryAlert = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: inventoryAlertApi.dismiss,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: inventoryAlertKeys.list(userId) });
        },
    });
};

export const useComputeInventoryAlerts = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => beanStockEventApi.computeInventoryAlerts(userId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: inventoryAlertKeys.list(userId) });
            qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
            qc.invalidateQueries({ queryKey: dashboardKeys.all(userId) });
        },
    });
};
