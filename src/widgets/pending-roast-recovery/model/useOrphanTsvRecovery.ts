import { roastSessionApi } from '@entities/roast';
import { useRoastingStore } from '@features/active-roast';
import { readPendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import * as Sentry from '@sentry/react';
import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { listLocalTsvFiles, type PairedLocalTsv, pairLocalTsvsToSessions } from '@shared/lib/tsv-writer';
import { useToastStore } from '@shared/store/toast';
import { useEffect, useRef, useState } from 'react';

type SyncRoastCurve = (input: { sessionId: string; roastSessionId: string }) => Promise<unknown>;

export const useOrphanTsvRecovery = (opts: {
    enabled: boolean;
    workspaceOwnerId: string;
    /** Session just recovered via pending save — skip so we do not double-upload. */
    recoveredSessionId: string | null;
    syncRoastCurve: SyncRoastCurve;
}) => {
    const { enabled, workspaceOwnerId, recoveredSessionId, syncRoastCurve } = opts;
    const [unmatched, setUnmatched] = useState<PairedLocalTsv[]>([]);
    const startedRef = useRef(false);

    useEffect(() => {
        if (!enabled || !workspaceOwnerId || startedRef.current) return;
        startedRef.current = true;

        void (async () => {
            try {
                const liveSessionId = useRoastingStore.getState().sessionId;
                const pendingSessionId = readPendingRoastSave()?.params.sessionId ?? null;
                const ignore = new Set(
                    [liveSessionId, pendingSessionId, recoveredSessionId]
                        .filter((id): id is string => Boolean(id))
                        .map((id) => id.toLowerCase()),
                );

                const files = (await listLocalTsvFiles()).filter((file) => !ignore.has(file.sessionId));
                const ids = [...new Set(files.map((file) => file.sessionId))];
                const sessions = await roastSessionApi.listTsvStateByIds(ids);
                const plan = pairLocalTsvsToSessions(files, sessions, workspaceOwnerId);

                Sentry.addBreadcrumb({
                    category: 'tsv.orphan',
                    message: 'orphan tsv scan',
                    level: 'info',
                    data: {
                        fileCount: files.length,
                        needsUpload: plan.needsUpload.length,
                        unmatched: plan.unmatched.length,
                    },
                });

                let uploaded = 0;
                let failed = 0;
                for (const item of plan.needsUpload) {
                    try {
                        await syncRoastCurve({ sessionId: item.sessionId, roastSessionId: item.roastSessionId });
                        uploaded += 1;
                        Sentry.addBreadcrumb({
                            category: 'tsv.orphan',
                            message: 'orphan tsv reupload ok',
                            level: 'info',
                            data: { sessionId: item.sessionId },
                        });
                    } catch (err) {
                        failed += 1;
                        Sentry.addBreadcrumb({
                            category: 'tsv.orphan',
                            message: 'orphan tsv reupload failed',
                            level: 'error',
                            data: { sessionId: item.sessionId },
                        });
                        logger.capture(err, { context: 'orphan tsv reupload', sessionId: item.sessionId });
                    }
                }

                if (uploaded > 0) {
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.orphanUploaded', { count: uploaded }));
                }
                // Per-item failures already toast via MutationCache; only count when none succeeded.
                if (failed > 0 && uploaded === 0) {
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.orphanUploadFailed', { count: failed }));
                }

                if (plan.unmatched.length > 0) setUnmatched(plan.unmatched);
            } catch (err) {
                logger.capture(err, { context: 'orphan tsv scan' });
            }
        })();
    }, [enabled, workspaceOwnerId, recoveredSessionId, syncRoastCurve]);

    return { unmatched, dismissUnmatched: () => setUnmatched([]) };
};
