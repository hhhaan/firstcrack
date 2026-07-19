import { useActiveWorkspace } from '@entities/organization';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
import { roastedStockEventApi, roastedStockKeys } from '@entities/roasted-stock-event';
import { orderKeys } from '@shared/lib/query-keys';
import { supabase } from '@shared/lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildPackagingEvents } from '../lib/buildPackagingEvents';

export interface PackageProductParams {
    productId: string;
    units: number;
    note?: string;
}

/** 포장 입고: 완제품 +units, 벌크 원두 −units×net_weight. 부족해도 막지 않고 shortage만 보고. */
export const usePackageProduct = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    const mutation = useMutation({
        mutationFn: async ({ productId, units, note }: PackageProductParams) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');

            const { data: product, error } = await supabase
                .from('products')
                .select('id, bean_id, blend_id, net_weight_grams')
                .eq('id', productId)
                .single();
            if (error) throw error;

            const opId = crypto.randomUUID();
            const { productEvents, roastedEvents } = buildPackagingEvents({
                userId: workspaceOwnerId,
                productId,
                units,
                netWeightGrams: product.net_weight_grams,
                beanId: product.bean_id,
                blendId: product.blend_id,
                opId,
                note,
            });

            // 경고용 부족량 (비차단 — 유연 원칙 ①)
            let shortageGrams: number | null = null;
            if (roastedEvents.length > 0) {
                const stock = await roastedStockEventApi.getUserRoastedStock(workspaceOwnerId);
                const key = product.blend_id ? `blend:${product.blend_id}` : `bean:${product.bean_id}`;
                const have = stock[key]?.grams ?? 0;
                const need = units * product.net_weight_grams;
                if (have < need) shortageGrams = need - have;
            }

            await productStockEventApi.insertPackagingOp(productEvents, roastedEvents);

            return { ownerId: workspaceOwnerId, shortageGrams };
        },
        onSuccess: ({ ownerId }) => {
            void qc.invalidateQueries({ queryKey: productStockKeys.byUser(ownerId) });
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(ownerId) });
            void qc.invalidateQueries({ queryKey: orderKeys.requirements(ownerId) });
        },
    });

    return {
        packageProduct: async (p: PackageProductParams) => {
            const { shortageGrams } = await mutation.mutateAsync(p);
            return { shortageGrams };
        },
        isPending: mutation.isPending,
    };
};
