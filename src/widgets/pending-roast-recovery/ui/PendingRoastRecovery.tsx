import { useActiveWorkspace } from '@entities/organization';
import { planBatchApi } from '@entities/plan';
import { resumePendingRoastSave } from '@features/active-roast/lib/resumePendingRoastSave';
import { isPermanentSaveError } from '@features/active-roast/lib/saveErrorClassification';
import { clearPendingRoastSave, readPendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import { useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';

/**
 * Saves a roast whose save was interrupted — auth kick to the login screen,
 * crash, or force quit. Submitted saves retry silently; a summary that was
 * opened but never submitted asks first (form values are modal defaults, so
 * the user consents before an unattended save). Renders nothing.
 */
export const PendingRoastRecovery = () => {
    const [pending] = useState(readPendingRoastSave);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { saveRoast } = useSaveRoast(pending?.params.planBatchHandoff ?? null, syncRoastCurve);
    const startedRef = useRef(false);

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
                await resumePendingRoastSave({
                    pending,
                    ownerId: workspaceOwnerId,
                    resolveForRoast: planBatchApi.resolveForRoast,
                    saveRoast,
                });
                clearPendingRoastSave();
                useToastStore.getState().show(i18n.t('activeRoast.recovery.saved'));
            } catch (err) {
                logger.capture(err, { context: 'pending roast recovery' });
                // Idempotency converges retries only for transient failures. An integrity
                // violation (bad weights, deleted bean) reproduces identically forever and
                // there is no screen here to fix the values, so keeping the snapshot would
                // fail on every launch — discard it instead (#181).
                // 22P02 / bad plan ids are fixable — resumePendingRoastSave marks
                // needs_attention and keeps the same session UUID.
                if (isPermanentSaveError(err)) {
                    clearPendingRoastSave();
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.discarded'));
                    return;
                }
                // Snapshot kept — retried on next launch. save_roast_op is idempotent
                // on the client sessionId, so repeated attempts converge on one row.
                useToastStore.getState().show(i18n.t('activeRoast.recovery.failed'));
            }
        })();
    }, [pending, isWorkspaceReady, workspaceOwnerId, saveRoast]);

    return null;
};
