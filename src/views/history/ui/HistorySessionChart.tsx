import { sessionBeanName, useBbpCurve, useHistoryChart } from '@entities/roast';
import { resolveSourceSession, useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import { formatTemp, toDisplayRoR, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import { getResolvedChartColors } from '@features/active-roast/lib/chart-config';
import { parseStoredRoastEvents, storedEventsToMarkers } from '@features/active-roast/lib/serialize-roast-events';
import { RoastTempChart, type RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { historyPdfFilename, useExportHistoryPdf } from '@features/export-history-pdf';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import { combineBbpCurve } from '@shared/lib/roast-curve';
import { useThemeStore } from '@shared/store/theme';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { message } from '@tauri-apps/plugin-dialog';
import { FileDown } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function HistorySessionChart({ session }: { session: RoastSessionWithRelations }) {
    const { t } = useTranslation();
    const { temperatureUnit: unit, eventMarkerStyle, tempMinC, tempMaxC } = useRoastSettings();
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const roast = useHistoryChart(session.tsv_path ?? null);
    const bbp = useBbpCurve(session.user_id, session.id, session.bbp_tsv_path);
    const { data: profiles = [] } = useRoastProfiles(session.user_id);
    const profile = profiles.find((p) => p.id === session.profile_id && p.user_id === session.user_id) ?? null;
    const source = resolveSourceSession(profile?.source_session);
    const { points: targetPoints } = useResolvedProfileCurve(profile);
    const targetBbp = useBbpCurve(session.user_id, profile?.source_session_id ?? null, source?.bbp_tsv_path);
    const actual = useMemo(
        () =>
            combineBbpCurve(
                roast.isError ? [] : roast.points,
                bbp.isError ? [] : (bbp.data ?? []),
                session.bbp_seconds,
            ),
        [roast.points, roast.isError, bbp.data, bbp.isError, session.bbp_seconds],
    );
    const target = useMemo(
        () => combineBbpCurve(targetPoints, targetBbp.isError ? [] : (targetBbp.data ?? []), source?.bbp_seconds),
        [targetPoints, targetBbp.data, targetBbp.isError, source?.bbp_seconds],
    );
    const eventMarkers = useMemo(() => {
        void resolvedTheme;
        return storedEventsToMarkers(parseStoredRoastEvents(session.events), unit);
    }, [session.events, unit, resolvedTheme]);
    const { points } = actual;
    const hasControls = points.some((p) => p.heater != null || p.fan != null || p.drum != null);
    const bbpRange =
        actual.bbpRange || target.bbpRange
            ? { start: Math.min(actual.bbpRange?.start ?? 0, target.bbpRange?.start ?? 0), end: 0 }
            : undefined;
    const chartRef = useRef<RoastTempChartHandle>(null);
    const exportPdf = useExportHistoryPdf();
    const [exporting, setExporting] = useState(false);
    const canExport = points.length > 0 && !exporting;

    const onExportPdf = useCallback(async () => {
        const chartDataUrl = chartRef.current?.getDataURL();
        if (!chartDataUrl) {
            await message(t('history.exportPdfUnavailable'), { title: t('history.exportTitle'), kind: 'info' });
            return;
        }
        const colors = getResolvedChartColors();
        setExporting(true);
        try {
            await exportPdf({
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
                legend: hasControls
                    ? [
                          { color: colors.controlDrum, label: 'Drum' },
                          { color: colors.controlHeat, label: 'Heat' },
                          { color: colors.controlFan, label: 'Fan' },
                      ]
                    : undefined,
            });
        } finally {
            setExporting(false);
        }
    }, [exportPdf, hasControls, session, t, unit]);

    return (
        <section className="mt-4 rounded bg-(--color-roast-bg) p-3" aria-label={t('history.title')}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs text-secondary">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <span>
                        BBP · {t('bbp.duration')}: {formatDuration(session.bbp_seconds)}
                    </span>
                    <span>
                        {t('bbp.chargeTemp')}: {formatTemp(session.charge_temp_celsius, unit)}
                    </span>
                    {(bbp.isLoading || bbp.isError || !bbp.data?.length) && (
                        <span role="status">
                            {t(bbp.isLoading ? 'bbp.loading' : bbp.isError ? 'bbp.failed' : 'bbp.empty')}
                        </span>
                    )}
                    {roast.isLoading && <span role="status">{t('history.expanded.chartLoading')}</span>}
                    {roast.isError && <span role="status">{t('history.expanded.chartUnavailable')}</span>}
                    {profile && (targetBbp.isLoading || targetBbp.isError) && (
                        <span role="status">
                            {t('bbp.target')} · {t(targetBbp.isLoading ? 'bbp.loading' : 'bbp.failed')}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    data-testid="history-export-pdf"
                    onClick={() => void onExportPdf()}
                    disabled={!canExport}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-none bg-primary px-3 py-1.5 text-[12px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#0d0d0d]"
                >
                    <FileDown size={14} strokeWidth={2} />
                    {t('history.exportPdf')}
                </button>
            </div>
            {points.length > 0 && (
                <RoastTempChart
                    ref={chartRef}
                    xs={points.map((p) => p.t)}
                    btActual={points.map((p) => toDisplayTemp(p.bt, unit))}
                    etActual={points.map((p) => (p.et == null ? null : toDisplayTemp(p.et, unit)))}
                    rorActual={points.map((p) => (p.ror == null ? null : toDisplayRoR(p.ror, unit)))}
                    btTarget={[]}
                    targetXs={target.points.map((p) => p.t)}
                    targetBt={target.points.map((p) => toDisplayTemp(p.bt, unit))}
                    showTargetCurve={target.points.length > 0}
                    currentTimeSec={0}
                    eventMarkerStyle={eventMarkerStyle}
                    eventMarkers={eventMarkers}
                    showRoRET={false}
                    temperatureUnit={unit}
                    tempMinC={Math.min(
                        tempMinC,
                        ...points.map((p) => Math.floor(Math.min(p.bt, p.et ?? p.bt) / 10) * 10),
                    )}
                    tempMaxC={Math.max(
                        tempMaxC,
                        ...points.map((p) => Math.ceil(Math.max(p.bt, p.et ?? p.bt) / 10) * 10),
                    )}
                    xViewMin={bbpRange?.start ?? 0}
                    xViewMax={Math.max(
                        1,
                        session.duration_seconds ?? 0,
                        points[points.length - 1].t,
                        target.points[target.points.length - 1]?.t ?? 0,
                    )}
                    bbpRange={bbpRange}
                    controlData={
                        hasControls
                            ? {
                                  xs: points.map((p) => p.t),
                                  drumTemp: points.map((p) => p.drum),
                                  heatPower: points.map((p) => p.heater),
                                  fanSpeed: points.map((p) => p.fan),
                                  heatSet: points.map((p) => p.heaterSet ?? null),
                              }
                            : undefined
                    }
                    height={550}
                />
            )}
        </section>
    );
}
