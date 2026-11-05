import { useActiveWorkspace } from '@entities/organization';
import { roastChargeApi } from '@entities/roast-charge';
import {
    BatchLimitError,
    isWritablePlan,
    mapServerBatchGateError,
    planChargeCap,
    useEffectivePlan,
    useRoastChargeUsage,
} from '@shared/lib/features';
import { useExpiryClock } from '@shared/lib/features/useExpiryClock';
import { logger } from '@shared/lib/logger';
import { roastChargeKeys } from '@shared/lib/query-keys';
import { retryUnlessClientRefusal } from '@shared/lib/sentry';
import { useToastStore } from '@shared/store/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRoastSaveError } from '../lib/saveErrorClassification';
import { enqueueRoastCharge } from './pendingRoastCharges';
import { useRoastingStore } from './status';

export type ChargeAdmission = {
    ready: boolean;
    take: () => string | null;
    confirm: (sessionId: string, chargedAt: number) => void;
};

/** Reserve during preheat/wait: Charge itself must never wait for the network. */
export function useRoastChargeAdmission(): ChargeAdmission {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const plan = useEffectivePlan();
    const limited = planChargeCap(plan) != null;
    const writable = isWorkspaceReady && !!workspaceOwnerId && isWritablePlan(plan);
    const { data: grant } = useRoastChargeUsage(workspaceOwnerId, plan, limited && writable);
    const now = useExpiryClock(grant?.period_end);
    const endsAt = grant?.period_end ? new Date(grant.period_end).getTime() : 0;
    const waiting = useRoastingStore((s) => s.phase === 'preheating' || s.phase === 'standby');
    const qc = useQueryClient();
    const slot = useRef<{ owner: string; id: string; scope: string } | null>(null);
    const scope = `${workspaceOwnerId}:${plan}:${endsAt}`;
    const retryPreparation = useRef<(() => void) | null>(null);
    const available = grant ? (grant.batch_cap ?? Infinity) - grant.used_batches - grant.reserved_batches : 0;
    const previousCapacity = useRef({ owner: workspaceOwnerId, available });
    const [readyScope, setReadyScope] = useState<string | null>(null);
    const eligible = limited && writable && waiting && now < endsAt;
    const { mutateAsync: reserve } = useMutation({
        mutationFn: async ({ owner, id }: { owner: string; id: string }) => {
            try {
                await roastChargeApi.reserve(owner, id);
            } catch (err) {
                throw mapServerBatchGateError(err) ?? err;
            }
        },
        retry: retryUnlessClientRefusal,
    });

    useEffect(() => {
        if (!eligible) return;
        const owner = workspaceOwnerId;
        let id: string;
        let alive = true;
        const invalidate = () => void qc.invalidateQueries({ queryKey: roastChargeKeys.all(owner) });
        const release = (reservationId: string) =>
            void roastChargeApi
                .release(owner, reservationId)
                .then(invalidate)
                .catch((err) => logger.capture(err, { feature: 'roast-charge-release' }));
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
                    slot.current = { owner, id: attemptId, scope };
                    setReadyScope(scope);
                    invalidate();
                })
                .catch((err) => {
                    // A transport failure can hide a committed reservation; release is idempotent.
                    release(attemptId);
                    if (alive) {
                        if (
                            err instanceof BatchLimitError &&
                            ['trial_event_batch_cap', 'trial_batch_cap', 'monthly_batch_cap'].includes(err.code)
                        ) {
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
            setReadyScope(null);
            if (slot.current?.id === id) {
                slot.current = null;
                release(id);
            }
        };
    }, [eligible, workspaceOwnerId, scope, reserve, qc]);

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
        if (!writable) return null;
        if (!limited) return crypto.randomUUID();
        const prepared = slot.current;
        if (!prepared || prepared.scope !== scope || Date.now() >= endsAt) return null;
        slot.current = null;
        setReadyScope(null);
        return prepared.id;
    }, [scope, endsAt, limited, writable]);

    const confirm = useCallback(
        (sessionId: string, chargedAt: number) => {
            enqueueRoastCharge({
                owner: workspaceOwnerId,
                id: sessionId,
                chargedAt: new Date(chargedAt).toISOString(),
            });
        },
        [workspaceOwnerId],
    );
    return { ready: limited ? eligible && readyScope === scope : writable, take, confirm };
}
