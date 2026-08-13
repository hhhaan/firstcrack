import { useActiveWorkspace } from '@entities/organization';
import {
    clearPendingRoastSave,
    readPendingRoastSave,
    toSaveRoastParams,
} from '@features/active-roast/model/pendingRoastSave';
import { useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';
import { useOrphanTsvRecovery } from '../model/useOrphanTsvRecovery';
import { OrphanTsvList } from './OrphanTsvList';

/**
 * App-start recovery: interrupted saves (auth kick / crash) plus leftover local
 * TSV after a failed R2 upload. Submitted saves and tsv_path-null sessions retry
 * silently; an unsubmitted summary asks first; TSV with no session row is listed.
 */
export const PendingRoastRecovery = () => {
    const [pending] = useState(readPendingRoastSave);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { saveRoast } = useSaveRoast(pending?.params.planBatchHandoff ?? null, syncRoastCurve);
    const startedRef = useRef(false);
    const [pendingSettled, setPendingSettled] = useState(() => !pending);
    const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);

    useEffect(() => {
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        if (!pending || pending.params.userId !== workspaceOwnerId) {
            setPendingSettled(true);
        }
    }, [pending, isWorkspaceReady, workspaceOwnerId]);

    useEffect(() => {
        if (!pending || !isWorkspaceReady || !workspaceOwnerId || startedRef.current) return;
        // Different workspace than the one that roasted — keep the snapshot for the right account.
        if (pending.params.userId !== workspaceOwnerId) return;
        startedRef.current = true;

        void (async () => {
            try {
                if (!pending.submitted) {
                    const restore = await ask(i18n.t('activeRoast.recovery.askMsg'), {
                        title: i18n.t('activeRoast.recovery.title'),
                    });
                    if (!restore) {
                        clearPendingRoastSave();
                        return;
                    }
                }
                await saveRoast(toSaveRoastParams(pending.params));
                clearPendingRoastSave();
                setRecoveredSessionId(pending.params.sessionId);
                useToastStore.getState().show(i18n.t('activeRoast.recovery.saved'));
            } catch (err) {
                // Snapshot kept — retried on next launch. save_roast_op is idempotent
                // on the client sessionId, so repeated attempts converge on one row.
                logger.capture(err, { context: 'pending roast recovery' });
                useToastStore.getState().show(i18n.t('activeRoast.recovery.failed'));
            } finally {
                setPendingSettled(true);
            }
        })();
    }, [pending, isWorkspaceReady, workspaceOwnerId, saveRoast]);

    const { unmatched, dismissUnmatched } = useOrphanTsvRecovery({
        enabled: isWorkspaceReady && !!workspaceOwnerId && pendingSettled,
        workspaceOwnerId,
        recoveredSessionId,
        syncRoastCurve,
    });

    if (unmatched.length === 0) return null;
    return <OrphanTsvList items={unmatched} onDismiss={dismissUnmatched} />;
};
