import { dashboardKeys, inventoryQueryRoots } from '@shared/lib/query-keys';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type InventoryAlert, inventoryAlertApi } from './api';

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

/** Server dismiss is the only write path; dashboard is often unmounted (#274). */
export const invalidateAfterDismissAlert = (qc: QueryClient, userId: string) => {
    void qc.invalidateQueries({ queryKey: inventoryAlertKeys.list(userId) });
    void qc.invalidateQueries({ queryKey: dashboardKeys.all(userId), refetchType: 'all' });
};

export const useDismissInventoryAlert = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: inventoryAlertApi.dismiss,
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: inventoryAlertKeys.list(userId) });
            const prev = qc.getQueryData<InventoryAlert[]>(inventoryAlertKeys.list(userId));
            qc.setQueryData<InventoryAlert[]>(inventoryAlertKeys.list(userId), (old = []) =>
                old.filter((a) => a.id !== id),
            );
            return { prev };
        },
        onError: (_err, _id, ctx) => {
            if (ctx?.prev) qc.setQueryData(inventoryAlertKeys.list(userId), ctx.prev);
        },
        onSuccess: () => {
            invalidateAfterDismissAlert(qc, userId);
        },
    });
};
