import { appendRoastControlAudit } from '@entities/roast-control-audit';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
    acknowledgeDischargeAudit,
    listPendingDischargeAudits,
    type PendingDischargeAudit,
    replayDischargeAuditEvent,
} from '../lib/replayDischargeAudit';

// One uploader across remounts, including a workspace switch during an in-flight request.
let uploading = false;
let reportedStorageFailure = false;

/** Mounted at app recovery, independent of the roast screen. Only metadata is ever retried. */
export function usePendingDischargeAudits(actorId: string, ready: boolean) {
    const { mutateAsync: deliver } = useMutation({
        mutationFn: async (record: PendingDischargeAudit) => {
            if (useAuthStore.getState().user?.id !== record.actorId) {
                throw new DOMException('Audit delivery cancelled', 'AbortError');
            }
            const receivedAt = await appendRoastControlAudit({
                p_user_id: record.ownerId,
                p_actor_id: record.actorId,
                p_payload: record.payload,
            });
            await acknowledgeDischargeAudit(record, receivedAt);
        },
        meta: { feature: 'replay-discharge-audit-outbox', rpc: 'append_replay_discharge_audit' },
        // The durable outbox owns retry timing, including while the browser reports offline.
        retry: false,
        networkMode: 'always',
    });
    useEffect(() => {
        if (!ready || !actorId) return;
        let alive = true;
        const requested = new Set<true>();
        const drain = async () => {
            requested.add(true);
            if (uploading) return;
            uploading = true;
            try {
                do {
                    requested.clear();
                    const records = await listPendingDischargeAudits();
                    for (const record of records) {
                        if (!alive || useAuthStore.getState().user?.id !== actorId) return;
                        if (record.actorId !== actorId) continue;
                        try {
                            await deliver(record);
                        } catch {
                            // Retain durably on refusal/network/ACK failure; never retry a physical command.
                            // MutationCache owns failure reporting.
                        }
                    }
                } while (alive && requested.has(true));
            } catch (error) {
                if (!reportedStorageFailure) {
                    reportedStorageFailure = true;
                    logger.capture(error, { feature: 'replay-discharge-audit-outbox' });
                }
            } finally {
                uploading = false;
            }
        };
        const retry = () => {
            void drain();
        };
        retry();
        const timer = window.setInterval(retry, 30_000);
        window.addEventListener(replayDischargeAuditEvent, retry);
        window.addEventListener('online', retry);
        return () => {
            alive = false;
            window.clearInterval(timer);
            window.removeEventListener(replayDischargeAuditEvent, retry);
            window.removeEventListener('online', retry);
        };
    }, [actorId, ready, deliver]);
}
