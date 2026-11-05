import { useActiveWorkspace } from '@entities/organization';
import { trialEventApi } from '@entities/trial-event';
import {
    BatchLimitError,
    mapServerBatchGateError,
    TRIAL_EVENT_BATCH_CAP,
    useEffectivePlan,
    useTrialEventGrant,
} from '@shared/lib/features';
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
    const retryPreparation = useRef<(() => void) | null>(null);
    const available = grant ? TRIAL_EVENT_BATCH_CAP - grant.used_batches - grant.reserved_batches : 0;
    const previousCapacity = useRef({ owner: workspaceOwnerId, available });
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
    const { mutateAsync: charge } = useMutation({
        mutationFn: ({ owner, id }: { owner: string; id: string }) => trialEventApi.charge(owner, id),
        retry: retryUnlessClientRefusal,
        onSettled: (_data, _error, { owner }) => qc.invalidateQueries({ queryKey: trialEventKeys.grant(owner) }),
    });

    useEffect(() => {
        if (!eligible) return;
        const owner = workspaceOwnerId;
        let id: string;
        let alive = true;
        const invalidate = () => void qc.invalidateQueries({ queryKey: trialEventKeys.grant(owner) });
        const release = (reservationId: string) =>
            void trialEventApi
                .release(owner, reservationId)
                .then(invalidate)
                .catch((err) => logger.capture(err, { feature: 'trial-event-release' }));
        const prepare = () => {
            retryPreparation.current = null;
            id = crypto.randomUUID();
            const attemptId = id;
            const capacityAtStart = previousCapacity.current;
            void reserve({ owner, id: attemptId })
                .then(() => {
                    if (!alive) {
                        release(attemptId);
                        return;
                    }
                    slot.current = { owner, id: attemptId };
                    setReadyOwner(owner);
                    invalidate();
                })
                .catch((err) => {
                    // A transport failure can hide a committed reservation; release is idempotent.
                    release(attemptId);
                    if (alive) {
                        if (err instanceof BatchLimitError && err.code === 'trial_event_batch_cap') {
                            retryPreparation.current = prepare;
                            const current = previousCapacity.current;
                            // Capacity can return before the refusal reaches this device.
                            if (current.owner === owner && current.available > capacityAtStart.available) prepare();
                        }
                        useToastStore.getState().show(formatRoastSaveError(err));
                    }
                });
        };
        prepare();
        return () => {
            alive = false;
            retryPreparation.current = null;
            setReadyOwner(null);
            if (slot.current?.id === id) {
                slot.current = null;
                release(id);
            }
        };
    }, [eligible, workspaceOwnerId, reserve, qc]);

    useEffect(() => {
        const previous = previousCapacity.current;
        previousCapacity.current = { owner: workspaceOwnerId, available };
        // Retry only a refused preparation when capacity returns. Putting counters
        // in the reservation effect would release/re-reserve its own final slot.
        if (previous.owner === workspaceOwnerId && available > previous.available) {
            retryPreparation.current?.();
        }
    }, [workspaceOwnerId, available]);

    const take = useCallback(() => {
        const prepared = slot.current;
        if (!prepared || prepared.owner !== workspaceOwnerId || Date.now() >= endsAt) return null;
        slot.current = null;
        setReadyOwner(null);
        // The reserved slot already protects the cap even while offline. Never
        // release it after Charge; saving can also finalize a delayed charge.
        void charge(prepared).catch((err) => useToastStore.getState().show(formatRoastSaveError(err)));
        return prepared.id;
    }, [workspaceOwnerId, endsAt, charge]);

    return plan === 'trial-event' ? { ready: eligible && readyOwner === workspaceOwnerId, take } : undefined;
}
