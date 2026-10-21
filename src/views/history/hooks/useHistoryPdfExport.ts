import { sessionBeanName } from '@entities/roast';
import { formatTemp, type TemperatureUnit } from '@features/active-roast';
import type { RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { historyPdfChartBox, historyPdfFilename, useExportHistoryPdf } from '@features/export-history-pdf';
import { formatDateTimeShort, formatDuration } from '@shared/lib/format';
import { sessionDistinctTitle, sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { useToastStore } from '@shared/store/toast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { type RefObject, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { historyPdfLegend } from '../lib/historyPdfLegend';

type Args = {
    session: RoastSessionWithRelations;
    chartRef: RefObject<RoastTempChartHandle | null>;
    hasControls: boolean;
    hasTarget?: boolean;
    unit: TemperatureUnit;
    canCapture: boolean;
};

export const useHistoryPdfExport = ({ session, chartRef, hasControls, hasTarget = false, unit, canCapture }: Args) => {
    const { t } = useTranslation();
    const exportPdf = useExportHistoryPdf();
    const [exporting, setExporting] = useState(false);

    const onExportPdf = useCallback(async () => {
        const chartDataUrl = chartRef.current?.getDataURL({ ...historyPdfChartBox(true), pixelRatio: 200 / 96 });
        if (!chartDataUrl) {
            useToastStore.getState().show(t('history.exportPdfUnavailable'), 'error');
            return;
        }
        setExporting(true);
        try {
            const beanName = sessionBeanName(session)?.trim() || '—';
            const distinctTitle = sessionDistinctTitle(session);
            await exportPdf({
                title: t('history.title'),
                filename: historyPdfFilename(sessionRoastTitle(session), session.roasted_at),
                chartDataUrl,
                header: {
                    bean: beanName,
                    ...(distinctTitle ? { roastTitle: distinctTitle } : {}),
                    date: formatDateTimeShort(session.roasted_at),
                    duration: formatDuration(session.duration_seconds),
                    charge: formatTemp(session.charge_temp_celsius, unit),
                    drop: formatTemp(session.drop_temp_celsius, unit),
                    labels: {
                        bean: t('history.table.bean'),
                        ...(distinctTitle ? { roastTitle: t('history.recordText.title') } : {}),
                        date: t('history.table.date'),
                        duration: t('history.table.duration'),
                        charge: t('history.compare.charge'),
                        drop: t('history.compare.dropTemp'),
                    },
                },
                legend: historyPdfLegend({ unit, hasTarget, hasControls, t }),
            });
        } finally {
            setExporting(false);
        }
    }, [chartRef, exportPdf, hasControls, hasTarget, session, t, unit]);

    return { exporting, canExport: canCapture && !exporting, onExportPdf };
};
