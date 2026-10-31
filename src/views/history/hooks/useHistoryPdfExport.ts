import type { TemperatureUnit } from '@features/active-roast';
import type { RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { historyPdfChartBox, historyPdfFilename, useExportHistoryPdf } from '@features/export-history-pdf';
import { formatDateTimeShort } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { useToastStore } from '@shared/store/toast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { type RefObject, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { historyPdfLegend } from '../lib/historyPdfLegend';

type Args = {
    session: RoastSessionWithRelations;
    chartRef: RefObject<RoastTempChartHandle | null>;
    unit: TemperatureUnit;
    hasEtRor?: boolean;
    canCapture: boolean;
    roasting?: boolean;
};

export const useHistoryPdfExport = ({
    session,
    chartRef,
    unit,
    hasEtRor = false,
    canCapture,
    roasting = false,
}: Args) => {
    const { t } = useTranslation();
    const exportPdf = useExportHistoryPdf();
    const [exporting, setExporting] = useState(false);

    const onExportPdf = useCallback(async () => {
        if (roasting) return;
        setExporting(true);
        try {
            await document.fonts.load(`400 ${roastPdfLayout.tickFontSize}px ${roastPdfLayout.fontFamily}`);
            // Capture at 200 dpi; getDataURL converts raster dimensions to PDF points.
            const chartDataUrl = chartRef.current?.getDataURL({ ...historyPdfChartBox(), pixelRatio: 200 / 72 });
            if (!chartDataUrl) {
                useToastStore.getState().show(t('history.exportPdfUnavailable'), 'error');
                return;
            }
            await exportPdf({
                title: sessionRoastTitle(session)?.trim() || t('history.title'),
                date: formatDateTimeShort(session.roasted_at),
                filename: historyPdfFilename(sessionRoastTitle(session), session.roasted_at),
                chartDataUrl,
                legend: historyPdfLegend(unit, hasEtRor),
            });
        } catch (error) {
            logger.capture(error, { feature: 'export-history-pdf' });
            useToastStore.getState().show(t('history.exportPdfFailed'), 'error');
        } finally {
            setExporting(false);
        }
    }, [chartRef, exportPdf, hasEtRor, roasting, session, t, unit]);

    return { exporting, canExport: canCapture && !exporting && !roasting, onExportPdf };
};
