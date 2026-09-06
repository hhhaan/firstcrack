import { clearLiveRoastDraft, readLiveRoastDraft } from '@features/active-roast/model/liveRoastDraft';
import { readPendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';

interface LiveRoastRecoveryProps {
    onResume: () => void;
}

/**
 * Charge–Drop crash journal. Asks once on launch; End-confirm saves are
 * handled by PendingRoastRecovery instead. Sidecar recorder is #308.
 */
export const LiveRoastRecovery = ({ onResume }: LiveRoastRecoveryProps) => {
    const [draft] = useState(readLiveRoastDraft);
    const startedRef = useRef(false);

    useEffect(() => {
        if (!draft || startedRef.current) return;
        if (readPendingRoastSave()) {
            clearLiveRoastDraft();
            return;
        }
        if (useRoastingStore.getState().isRoasting) return;
        startedRef.current = true;

        void (async () => {
            try {
                const restore = await ask(i18n.t('activeRoast.liveRecovery.askMsg'), {
                    title: i18n.t('activeRoast.liveRecovery.title'),
                    kind: 'warning',
                    okLabel: i18n.t('activeRoast.liveRecovery.resume'),
                    cancelLabel: i18n.t('activeRoast.liveRecovery.discard'),
                });
                if (!restore) {
                    clearLiveRoastDraft();
                    return;
                }
                useRoastingStore.getState().restoreDraft({
                    sessionId: draft.sessionId,
                    roastStartMs: draft.roastStartMs,
                    elapsed: draft.elapsed,
                });
                onResume();
            } catch (err) {
                logger.capture(err, { context: 'live roast recovery' });
            }
        })();
    }, [draft, onResume]);

    return null;
};
