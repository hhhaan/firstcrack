import { downloadPdf } from '@shared/lib/download';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import { downloadDir, join } from '@tauri-apps/api/path';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { composeHistoryPdf } from './lib/compose';
import type { ComposeHistoryPdfInput } from './lib/types';

export type ExportHistoryPdfInput = ComposeHistoryPdfInput & { filename: string };

export type HistoryPdfExportLabels = {
    title: string;
    okLabel: string;
    cancelLabel: string;
    confirmMessage: (path: string) => string;
};

const isTauriRuntime = (): boolean =>
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const confirmSave = async (filename: string, labels: HistoryPdfExportLabels): Promise<boolean> => {
    if (!isTauriRuntime()) return true;
    try {
        const path = await join(await downloadDir(), filename);
        return await confirm(labels.confirmMessage(path), {
            title: labels.title,
            kind: 'info',
            okLabel: labels.okLabel,
            cancelLabel: labels.cancelLabel,
        });
    } catch {
        // Vite / missing plugin: browser <a download> still works.
        return true;
    }
};

export const runExportHistoryPdf = async (
    input: ExportHistoryPdfInput,
    labels: HistoryPdfExportLabels,
): Promise<boolean> => {
    if (!(await confirmSave(input.filename, labels))) return false;
    const pdf = await composeHistoryPdf(input);
    downloadPdf(pdf, input.filename);
    return true;
};

export const useExportHistoryPdf = () => {
    const { t } = useTranslation();
    return useCallback(
        async (input: ExportHistoryPdfInput): Promise<boolean> => {
            try {
                return await runExportHistoryPdf(input, {
                    title: t('history.exportTitle'),
                    okLabel: t('history.exportOkLabel'),
                    cancelLabel: t('history.exportCancelLabel'),
                    confirmMessage: (path) => t('history.exportPdfConfirm', { path }),
                });
            } catch (err) {
                logger.capture(err, { context: 'export history pdf' });
                useToastStore.getState().show(t('history.exportPdfFailed'), 'error');
                return false;
            }
        },
        [t],
    );
};
