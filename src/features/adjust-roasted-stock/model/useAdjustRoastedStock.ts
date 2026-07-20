import { useActiveWorkspace } from '@entities/organization';
import { roastedStockEventApi, roastedStockKeys } from '@entities/roasted-stock-event';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildRoastedAdjustEvent, type RoastedAdjustParams } from '../lib/buildRoastedAdjustEvent';

export type AdjustRoastedParams = Omit<RoastedAdjustParams, 'userId' | 'referenceId'>;

export const useAdjustRoastedStock = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    return useMutation({
        mutationFn: async (p: AdjustRoastedParams) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            const event = buildRoastedAdjustEvent({
                ...p,
                userId: workspaceOwnerId,
                referenceId: crypto.randomUUID(),
            });
            if (!event) throw new Error('Invalid adjust amount');
            await roastedStockEventApi.insertBatch([event]);
            return workspaceOwnerId;
        },
        onSuccess: (ownerId) => {
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(ownerId) });
            void qc.invalidateQueries({ queryKey: roastedStockKeys.events(ownerId) });
        },
    });
};
