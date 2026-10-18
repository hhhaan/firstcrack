import { useActiveWorkspace } from '@entities/organization';
import { type Product, productApi, productKeys } from '@entities/product';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
import { ensureRoastedStock, type RoastedStockSummary, roastedStockKeys } from '@entities/roasted-stock-event';
import { createActionOpIdSession } from '@shared/lib/action-op-id';
import { orderKeys } from '@shared/lib/query-keys';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { buildPackagingEvents } from '../lib/buildPackagingEvents';
import { packagingContentKey } from '../lib/packagingContentKey';

export interface PackageProductParams {
    productId: string;
    units: number;
    note?: string;
}

type ProductSource = Pick<Product, 'id' | 'bean_id' | 'blend_id' | 'net_weight_grams'>;

const preDeductRoastedGrams = new WeakMap<PackageProductParams, number>();

async function resolveProduct(qc: QueryClient, userId: string, productId: string) {
    const cached = qc.getQueryData<Product[]>(productKeys.all(userId))?.find((p) => p.id === productId);
    if (cached) {
        return {
            id: cached.id,
            bean_id: cached.bean_id,
            blend_id: cached.blend_id,
            net_weight_grams: cached.net_weight_grams,
        } satisfies ProductSource;
    }
    const row = await productApi.get(productId);
    return {
        id: row.id,
        bean_id: row.bean_id,
        blend_id: row.blend_id,
        net_weight_grams: row.net_weight_grams,
    };
}

/** 포장 입고: 완제품 +units, 벌크 원두 −units×net_weight. 부족해도 막지 않고 shortage만 보고. */
export const usePackageProduct = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const opSession = useRef(createActionOpIdSession());

    const mutation = useMutation({
        mutationFn: async (params: PackageProductParams) => {
            const { productId, units, note } = params;
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');

            const product = await resolveProduct(qc, workspaceOwnerId, productId);
            const deltaGrams = product.bean_id || product.blend_id ? -(units * product.net_weight_grams) : 0;
            const contentKey = packagingContentKey({
                productId,
                units,
                beanId: product.bean_id,
                blendId: product.blend_id,
                deltaGrams,
            });
            const opId = opSession.current.getOrCreate(contentKey);
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

            let shortageGrams: number | null = null;
            if (roastedEvents.length > 0) {
                const key = product.blend_id ? `blend:${product.blend_id}` : `bean:${product.bean_id}`;
                const need = units * product.net_weight_grams;
                const snap = preDeductRoastedGrams.get(params);
                let have: number;
                if (snap !== undefined) {
                    have = snap;
                } else {
                    const stock = await ensureRoastedStock(qc, workspaceOwnerId);
                    have = stock[key]?.grams ?? 0;
                }
                if (have < need) shortageGrams = need - have;
            }

            await productStockEventApi.insertPackagingOp(productEvents, roastedEvents);
            opSession.current.markSucceeded();

            return { ownerId: workspaceOwnerId, product, units, shortageGrams };
        },
        onMutate: async (params) => {
            const { productId, units } = params;
            if (!workspaceOwnerId) return;
            const ownerId = workspaceOwnerId;
            const product = qc.getQueryData<Product[]>(productKeys.all(ownerId))?.find((p) => p.id === productId);

            await qc.cancelQueries({ queryKey: productStockKeys.byUser(ownerId) });
            await qc.cancelQueries({ queryKey: roastedStockKeys.byUser(ownerId) });

            const prevProductStock = qc.getQueryData<Record<string, number>>(productStockKeys.byUser(ownerId));
            const prevRoasted = qc.getQueryData<Record<string, RoastedStockSummary>>(roastedStockKeys.byUser(ownerId));

            if (product && (product.bean_id || product.blend_id)) {
                const key = product.blend_id ? `blend:${product.blend_id}` : `bean:${product.bean_id}`;
                const cur = prevRoasted?.[key]?.grams;
                if (cur !== undefined) preDeductRoastedGrams.set(params, cur);
            }

            qc.setQueryData<Record<string, number>>(productStockKeys.byUser(ownerId), (prev) => ({
                ...(prev ?? {}),
                [productId]: (prev?.[productId] ?? 0) + units,
            }));

            if (product && (product.bean_id || product.blend_id)) {
                const key = product.blend_id ? `blend:${product.blend_id}` : `bean:${product.bean_id}`;
                const need = units * product.net_weight_grams;
                qc.setQueryData<Record<string, RoastedStockSummary>>(roastedStockKeys.byUser(ownerId), (prev) => {
                    if (!prev) return prev;
                    const cur = prev[key] ?? { grams: 0, hasEstimate: false };
                    return { ...prev, [key]: { ...cur, grams: cur.grams - need } };
                });
            }

            return { ownerId, prevProductStock, prevRoasted };
        },
        onError: (_err, _vars, ctx) => {
            if (!ctx) return;
            if (ctx.prevProductStock !== undefined) {
                qc.setQueryData(productStockKeys.byUser(ctx.ownerId), ctx.prevProductStock);
            }
            if (ctx.prevRoasted !== undefined) {
                qc.setQueryData(roastedStockKeys.byUser(ctx.ownerId), ctx.prevRoasted);
            }
        },
        onSettled: (_data, _err, _vars, ctx) => {
            const ownerId = ctx?.ownerId ?? workspaceOwnerId;
            if (!ownerId) return;
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
