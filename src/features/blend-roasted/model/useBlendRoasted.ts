import { useActiveWorkspace } from '@entities/organization';
import { roastedStockEventApi, roastedStockKeys } from '@entities/roasted-stock-event';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type BuildBlendingEventsParams, buildBlendingEvents } from '../lib/buildBlendingEvents';

export type BlendRoastedParams = Omit<BuildBlendingEventsParams, 'userId' | 'opId'>;

export const useBlendRoasted = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    const mutation = useMutation({
        mutationFn: async (p: BlendRoastedParams) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            const events = buildBlendingEvents({ ...p, userId: workspaceOwnerId, opId: crypto.randomUUID() });
            await roastedStockEventApi.insertBatch(events);
            return workspaceOwnerId;
        },
        onSuccess: (ownerId) => {
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(ownerId) });
        },
    });

    return { blendRoasted: mutation.mutateAsync, isPending: mutation.isPending };
};
