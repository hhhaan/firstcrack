import { useActiveWorkspace } from '@entities/organization';
import { isPermanentSaveError } from '@features/active-roast/lib/saveErrorClassification';
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
                await saveRoast(toSaveRoastParams(pending.params));
                clearPendingRoastSave();
                useToastStore.getState().show(i18n.t('activeRoast.recovery.saved'));
            } catch (err) {
                logger.capture(err, { context: 'pending roast recovery' });
                if (isPermanentSaveError(err)) {
                    clearPendingRoastSave();
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.discarded'));
                    return;
                }
                useToastStore.getState().show(i18n.t('activeRoast.recovery.failed'));
            }
        })();
    }, [pending, isWorkspaceReady, workspaceOwnerId, saveRoast]);

    return null;
};
