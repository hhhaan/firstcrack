import { useActiveWorkspace } from '@entities/organization';
import { trialEventApi } from '@entities/trial-event';
import { mapServerBatchGateError, useEffectivePlan, useTrialEventGrant } from '@shared/lib/features';
import { useExpiryClock } from '@shared/lib/features/useExpiryClock';
import { logger } from '@shared/lib/logger';
import { trialEventKeys } from '@shared/lib/query-keys';
import { retryUnlessClientRefusal } from '@shared/lib/sentry';
import { useToastStore } from '@shared/store/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRoastSaveError } from '../lib/saveErrorClassification';
import { useRoastingStore } from './status';

export type ChargeAdmission = { ready: boolean; take: () => string | null };

/** Reserve during preheat/wait: Charge itself must never wait for the network. */
export function useTrialEventAdmission(): ChargeAdmission | undefined {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const plan = useEffectivePlan();
    const { data: grant } = useTrialEventGrant(workspaceOwnerId, plan === 'trial-event' && isWorkspaceReady);
    const now = useExpiryClock(grant?.ends_at);
    const endsAt = grant ? new Date(grant.ends_at).getTime() : 0;
    const waiting = useRoastingStore((s) => s.phase === 'preheating' || s.phase === 'standby');
    const qc = useQueryClient();
    const slot = useRef<{ owner: string; id: string } | null>(null);
    const [readyOwner, setReadyOwner] = useState<string | null>(null);
    const eligible = plan === 'trial-event' && isWorkspaceReady && !!workspaceOwnerId && waiting && now < endsAt;
    const { mutateAsync: reserve } = useMutation({
        mutationFn: async ({ owner, id }: { owner: string; id: string }) => {
            try {
                await trialEventApi.reserve(owner, id);
            } catch (err) {
                throw mapServerBatchGateError(err) ?? err;
            }
        },
        retry: retryUnlessClientRefusal,
    });

    useEffect(() => {
        if (!eligible) return;
        const owner = workspaceOwnerId;
        const id = crypto.randomUUID();
        let alive = true;
        const invalidate = () => void qc.invalidateQueries({ queryKey: trialEventKeys.grant(owner) });
        const release = () =>
            void trialEventApi
                .release(owner, id)
                .then(invalidate)
                .catch((err) => logger.capture(err, { feature: 'trial-event-release' }));
        void reserve({ owner, id })
            .then(() => {
                if (!alive) {
                    release();
                    return;
                }
                slot.current = { owner, id };
                setReadyOwner(owner);
                invalidate();
            })
            .catch((err) => {
                // A transport failure can hide a committed reservation; release is idempotent.
                release();
                if (alive) useToastStore.getState().show(formatRoastSaveError(err));
            });
        return () => {
            alive = false;
            setReadyOwner(null);
            if (slot.current?.id === id) {
                slot.current = null;
                release();
            }
        };
    }, [eligible, workspaceOwnerId, reserve, qc]);

    const take = useCallback(() => {
        const prepared = slot.current;
        if (!prepared || prepared.owner !== workspaceOwnerId || Date.now() >= endsAt) return null;
        slot.current = null;
        setReadyOwner(null);
        return prepared.id;
    }, [workspaceOwnerId, endsAt]);

    return plan === 'trial-event' ? { ready: eligible && readyOwner === workspaceOwnerId, take } : undefined;
}
