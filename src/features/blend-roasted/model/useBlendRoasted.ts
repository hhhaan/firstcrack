import { useActiveWorkspace } from '@entities/organization';
import { type RoastedStockSummary, roastedStockEventApi, roastedStockKeys } from '@entities/roasted-stock-event';
import { createActionOpIdSession } from '@shared/lib/action-op-id';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { type BuildBlendingEventsParams, buildBlendingEvents } from '../lib/buildBlendingEvents';

export type BlendRoastedParams = Omit<BuildBlendingEventsParams, 'userId' | 'opId'>;

export const useBlendRoasted = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    // H5: retry reuses opId so blend partial unique indexes no-op on double submit
    const opSession = useRef(createActionOpIdSession());

    const mutation = useMutation({
        mutationFn: async (p: BlendRoastedParams) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            const events = buildBlendingEvents({
                ...p,
                userId: workspaceOwnerId,
                opId: opSession.current.getOrCreate(),
            });
            await roastedStockEventApi.insertBlendingOp(events);
            opSession.current.markSucceeded();
            return workspaceOwnerId;
        },
        onMutate: async (p) => {
            if (!workspaceOwnerId) return;
            const ownerId = workspaceOwnerId;
            await qc.cancelQueries({ queryKey: roastedStockKeys.byUser(ownerId) });
            const prev = qc.getQueryData<Record<string, RoastedStockSummary>>(roastedStockKeys.byUser(ownerId));

            qc.setQueryData<Record<string, RoastedStockSummary>>(roastedStockKeys.byUser(ownerId), (old) => {
                if (!old) return old;
                const next = { ...old };
                for (const input of p.inputs) {
                    const key = `bean:${input.beanId}`;
                    const cur = next[key] ?? { grams: 0, hasEstimate: false };
                    next[key] = { ...cur, grams: cur.grams - input.grams };
                }
                const blendKey = `blend:${p.blendId}`;
                const cur = next[blendKey] ?? { grams: 0, hasEstimate: false };
                next[blendKey] = { ...cur, grams: cur.grams + p.outputGrams };
                return next;
            });

            return { ownerId, prev };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.prev !== undefined) {
                qc.setQueryData(roastedStockKeys.byUser(ctx.ownerId), ctx.prev);
            }
        },
        onSettled: (_data, _err, _vars, ctx) => {
            const ownerId = ctx?.ownerId ?? workspaceOwnerId;
            if (!ownerId) return;
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(ownerId) });
        },
    });

    return { blendRoasted: mutation.mutateAsync, isPending: mutation.isPending };
};
