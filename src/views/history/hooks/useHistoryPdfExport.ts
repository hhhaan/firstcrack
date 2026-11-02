import type { RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { historyPdfFilename, useExportHistoryPdf } from '@features/export-history-pdf';
import { formatDateTimeShort } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { useToastStore } from '@shared/store/toast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { type RefObject, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Args = {
    session: RoastSessionWithRelations;
    chartRef: RefObject<Pick<RoastTempChartHandle, 'capturePdf'> | null>;
    canCapture: boolean;
    roasting?: boolean;
};

export const useHistoryPdfExport = ({ session, chartRef, canCapture, roasting = false }: Args) => {
    const { t } = useTranslation();
    const exportPdf = useExportHistoryPdf();
    const [exporting, setExporting] = useState(false);

    const onExportPdf = useCallback(async () => {
        if (roasting) return;
        setExporting(true);
        try {
            const capture = await chartRef.current?.capturePdf();
            if (!capture?.chartDataUrl) {
                useToastStore.getState().show(t('history.exportPdfUnavailable'), 'error');
                return;
            }
            await exportPdf({
                title: sessionRoastTitle(session)?.trim() || t('history.title'),
                date: formatDateTimeShort(session.roasted_at),
                filename: historyPdfFilename(sessionRoastTitle(session), session.roasted_at),
                ...capture,
            });
        } catch (error) {
            logger.capture(error, { feature: 'export-history-pdf' });
            useToastStore.getState().show(t('history.exportPdfFailed'), 'error');
        } finally {
            setExporting(false);
        }
    }, [chartRef, exportPdf, roasting, session, t]);

    return { exporting, canExport: canCapture && !exporting && !roasting, onExportPdf };
};
