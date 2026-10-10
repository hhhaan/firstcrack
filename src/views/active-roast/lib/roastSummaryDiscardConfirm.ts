import { logger } from '@shared/lib/logger';
import { ask } from '@tauri-apps/plugin-dialog';
import type { TFunction } from 'i18next';

/** Same probe as quit / window-close (`__TAURI_INTERNALS__`). */
export const isTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type RoastSummaryDiscardLabels = {
    title: string;
    message: string;
    okLabel: string;
    cancelLabel: string;
};

export const roastSummaryDiscardLabels = (t: TFunction): RoastSummaryDiscardLabels => ({
    title: t('activeRoast.summary.discardConfirmTitle'),
    message: t('activeRoast.summary.discardConfirmMsg'),
    okLabel: t('activeRoast.summary.discardConfirmOk'),
    cancelLabel: t('activeRoast.summary.discardConfirmCancel'),
});

/** Desktop native confirm. Throws when the dialog plugin / invoke is unavailable. */
export const confirmRoastSummaryDiscardNative = async (labels: RoastSummaryDiscardLabels): Promise<boolean> => {
    return ask(labels.message, {
        title: labels.title,
        kind: 'warning',
        okLabel: labels.okLabel,
        cancelLabel: labels.cancelLabel,
    });
};

/** Native Tauri confirm when available; otherwise open the in-app confirm layer. */
export const requestRoastSummaryDiscardConfirm = async (
    labels: RoastSummaryDiscardLabels,
    onConfirmed: () => void,
    onRequestInAppConfirm: () => void,
): Promise<void> => {
    if (isTauriRuntime()) {
        try {
            const ok = await confirmRoastSummaryDiscardNative(labels);
            if (ok) onConfirmed();
            return;
        } catch (err) {
            logger.capture(err instanceof Error ? err : new Error(String(err)), {
                context: 'roastSummary.discardConfirm',
            });
        }
    }
    onRequestInAppConfirm();
};
