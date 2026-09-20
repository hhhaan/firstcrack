import { downloadPdf } from '@shared/lib/download';
import { logger } from '@shared/lib/logger';
import { jpegToLandscapeA4Pdf } from '@shared/lib/pdf-page';
import { downloadDir, join } from '@tauri-apps/api/path';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { type ComposeHistoryPdfInput, composeHistoryPdfJpeg } from './lib/compose';

export type ExportHistoryPdfInput = ComposeHistoryPdfInput & { filename: string };

export type HistoryPdfExportLabels = {
    title: string;
    okLabel: string;
    cancelLabel: string;
    confirmMessage: (path: string) => string;
};

export const runExportHistoryPdf = async (
    input: ExportHistoryPdfInput,
    labels: HistoryPdfExportLabels,
): Promise<boolean> => {
    const page = await composeHistoryPdfJpeg(input);
    const pdf = jpegToLandscapeA4Pdf(page.jpeg, page.width, page.height);
    const path = await join(await downloadDir(), input.filename);
    const confirmed = await confirm(labels.confirmMessage(path), {
        title: labels.title,
        kind: 'info',
        okLabel: labels.okLabel,
        cancelLabel: labels.cancelLabel,
    });
    if (!confirmed) return false;
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
                return false;
            }
        },
        [t],
    );
};
