import { sessionBeanName } from '@entities/roast';
import { formatTemp, type TemperatureUnit } from '@features/active-roast';
import { getResolvedChartColors } from '@features/active-roast/lib/chart-config';
import type { RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { historyPdfChartBox, historyPdfFilename, useExportHistoryPdf } from '@features/export-history-pdf';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import { useToastStore } from '@shared/store/toast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { type RefObject, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
        const colors = getResolvedChartColors(true);
        setExporting(true);
        try {
            await exportPdf({
                title: t('history.title'),
                filename: historyPdfFilename(sessionBeanName(session), session.roasted_at),
                chartDataUrl,
                header: {
                    bean: sessionBeanName(session) ?? '—',
                    date: formatDateShort(session.roasted_at),
                    duration: formatDuration(session.duration_seconds),
                    charge: formatTemp(session.charge_temp_celsius, unit),
                    drop: formatTemp(session.drop_temp_celsius, unit),
                    labels: {
                        bean: t('history.table.bean'),
                        date: t('history.table.date'),
                        duration: t('history.table.duration'),
                        charge: t('history.compare.charge'),
                        drop: t('history.compare.dropTemp'),
                    },
                },
                legend: [
                    { color: colors.btActual, label: `BT (°${unit})` },
                    { color: colors.etActual, label: `ET (°${unit})` },
                    { color: colors.rorActual, label: `RoR (°${unit}/min)` },
                    ...(hasTarget
                        ? [{ color: colors.btTarget, label: t('settings.tabs.roast.showTargetCurve'), dashed: true }]
                        : []),
                    ...(hasControls
                        ? [
                              { color: colors.controlDrum, label: 'Drum' },
                              { color: colors.controlHeat, label: 'Heat' },
                              { color: colors.controlFan, label: 'Fan' },
                          ]
                        : []),
                ],
            });
        } finally {
            setExporting(false);
        }
    }, [chartRef, exportPdf, hasControls, hasTarget, session, t, unit]);

    return { exporting, canExport: canCapture && !exporting, onExportPdf };
};
