import { orderApi, orderKeys } from '@entities/order';
import { productStockKeys } from '@entities/product-stock-event';
import { useAuthStore } from '@shared/store/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/** Fulfill an order via the atomic `fulfill_order` RPC (deduct stock + stamp fulfilled_at). */
export const useFulfillOrder = () => {
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);

    return useMutation({
        mutationFn: (orderId: string) => orderApi.fulfill(orderId),
        onSuccess: () => {
            if (!user) return;
            qc.invalidateQueries({ queryKey: orderKeys.all(user.id) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(user.id) });
            qc.invalidateQueries({ queryKey: productStockKeys.byUser(user.id) });
        },
    });
};
