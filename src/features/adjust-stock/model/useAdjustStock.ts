import { useActiveWorkspace } from '@entities/organization';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
import { roastedStockEventApi, roastedStockKeys } from '@entities/roasted-stock-event';
import type { AdjustStockSign, AdjustStockType } from '@shared/ui/AdjustStockFields';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildProductAdjustEvent } from '../lib/buildProductAdjustEvent';
import { buildRoastedAdjustEvent } from '../lib/buildRoastedAdjustEvent';

type SharedFields = {
    type: AdjustStockType;
    sign: AdjustStockSign;
    note: string;
};

export type AdjustProductInput = SharedFields & {
    kind: 'product';
    productId: string;
    units: number;
};

export type AdjustRoastedInput = SharedFields & {
    kind: 'roasted';
    beanId: string | null;
    blendId: string | null;
    grams: number;
};

export type AdjustStockInput = AdjustProductInput | AdjustRoastedInput;

export const useAdjustStock = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    return useMutation({
        mutationFn: async (p: AdjustStockInput) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            const referenceId = crypto.randomUUID();

            if (p.kind === 'product') {
                const event = buildProductAdjustEvent({
                    userId: workspaceOwnerId,
                    productId: p.productId,
                    type: p.type,
                    sign: p.sign,
                    units: p.units,
                    note: p.note,
                    referenceId,
                });
                if (!event) throw new Error('Invalid adjust amount');
                await productStockEventApi.insertMany([event]);
                return { ownerId: workspaceOwnerId, kind: 'product' as const, productId: p.productId };
            }

            const event = buildRoastedAdjustEvent({
                userId: workspaceOwnerId,
                beanId: p.beanId,
                blendId: p.blendId,
                type: p.type,
                sign: p.sign,
                grams: p.grams,
                note: p.note,
                referenceId,
            });
            if (!event) throw new Error('Invalid adjust amount');
            await roastedStockEventApi.insertBatch([event]);
            return { ownerId: workspaceOwnerId, kind: 'roasted' as const };
        },
        onSuccess: (result) => {
            if (result.kind === 'product') {
                void qc.invalidateQueries({ queryKey: productStockKeys.byUser(result.ownerId) });
                void qc.invalidateQueries({ queryKey: productStockKeys.events(result.ownerId, result.productId) });
                return;
            }
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(result.ownerId) });
            void qc.invalidateQueries({ queryKey: roastedStockKeys.events(result.ownerId) });
        },
    });
};
