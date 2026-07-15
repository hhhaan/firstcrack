import { orderKeys } from '@entities/order';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
import { useAuthStore } from '@shared/store/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface FinishedGoodsInbound {
    productId: string;
    units: number;
    /** roast_session.id when logged from a roast; omitted for standalone manual inbound. */
    referenceId?: string;
    note?: string;
}

/** Log roasted bags into finished-goods stock (+roast_inbound). */
export const useAddFinishedGoods = () => {
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);

    return useMutation({
        mutationFn: async ({ productId, units, referenceId, note }: FinishedGoodsInbound) => {
            if (!user) throw new Error('로그인이 필요합니다.');
            if (units <= 0) throw new Error('입고 수량은 1개 이상이어야 합니다.');

            await productStockEventApi.insertMany([
                {
                    user_id: user.id,
                    product_id: productId,
                    delta_units: units,
                    event_type: 'roast_inbound',
                    reference_id: referenceId,
                    note,
                },
            ]);
        },
        onSuccess: () => {
            if (!user) return;
            qc.invalidateQueries({ queryKey: productStockKeys.byUser(user.id) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(user.id) });
        },
    });
};
