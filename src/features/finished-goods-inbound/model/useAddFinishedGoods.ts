import { orderKeys } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
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
    const { workspaceOwnerId } = useActiveWorkspace();

    return useMutation({
        mutationFn: async ({ productId, units, referenceId, note }: FinishedGoodsInbound) => {
            if (!workspaceOwnerId) throw new Error('로그인이 필요합니다.');
            if (units <= 0) throw new Error('입고 수량은 1개 이상이어야 합니다.');

            await productStockEventApi.insertMany([
                {
                    user_id: workspaceOwnerId,
                    product_id: productId,
                    delta_units: units,
                    event_type: 'roast_inbound',
                    reference_id: referenceId,
                    note,
                },
            ]);
        },
        onSuccess: () => {
            if (!workspaceOwnerId) return;
            qc.invalidateQueries({ queryKey: productStockKeys.byUser(workspaceOwnerId) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(workspaceOwnerId) });
        },
    });
};
