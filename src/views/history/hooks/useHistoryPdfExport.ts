import type { TemperatureUnit } from '@features/active-roast';
import type { RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { historyPdfChartBox, historyPdfFilename, useExportHistoryPdf } from '@features/export-history-pdf';
import { formatDateTimeShort } from '@shared/lib/format';
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
    canCapture: boolean;
    roasting?: boolean;
};

export const useHistoryPdfExport = ({ session, chartRef, unit, canCapture, roasting = false }: Args) => {
    const { t } = useTranslation();
    const exportPdf = useExportHistoryPdf();
    const [exporting, setExporting] = useState(false);

    const onExportPdf = useCallback(async () => {
        if (roasting) return;
        // Capture at 200 dpi; getDataURL converts raster dimensions to PDF points.
        const chartDataUrl = chartRef.current?.getDataURL({ ...historyPdfChartBox(), pixelRatio: 200 / 72 });
        if (!chartDataUrl) {
            useToastStore.getState().show(t('history.exportPdfUnavailable'), 'error');
            return;
        }
        setExporting(true);
        try {
            await exportPdf({
                title: sessionRoastTitle(session)?.trim() || t('history.title'),
                date: formatDateTimeShort(session.roasted_at),
                filename: historyPdfFilename(sessionRoastTitle(session), session.roasted_at),
                chartDataUrl,
                legend: historyPdfLegend(unit),
            });
        } finally {
            setExporting(false);
        }
    }, [chartRef, exportPdf, roasting, session, t, unit]);

    return { exporting, canExport: canCapture && !exporting && !roasting, onExportPdf };
};
