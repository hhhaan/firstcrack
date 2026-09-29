import { ROASTER_REGISTRY, useMachines } from '@entities/machine';
import { useBbpCurve, useHistoryChart } from '@entities/roast';
import { resolveSourceSession, useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import { formatTemp, toDisplayRoR, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import {
    referenceCurveFromPoints,
    referenceHasControls,
    toDisplayReferenceCurve,
} from '@features/active-roast/lib/reference-curve';
import { parseStoredRoastEvents, storedEventsToMarkers } from '@features/active-roast/lib/serialize-roast-events';
import { RoastTempChart, type RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { editedHeatSet, profileHeaterBounds, withEditedHeaterLog } from '@features/machine-control/lib/heater-events';
import { formatDuration } from '@shared/lib/format';
import { combineBbpCurve } from '@shared/lib/roast-curve';
import { useThemeStore } from '@shared/store/theme';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { FileDown } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistoryPdfExport } from '../hooks/useHistoryPdfExport';
import { sessionDropTime } from '../lib/record-heat';

export function HistorySessionChart({ session }: { session: RoastSessionWithRelations }) {
    const { t } = useTranslation();
    const {
        temperatureUnit: unit,
        eventMarkerStyle,
        tempMinC,
        tempMaxC,
        showTargetCurve,
        showProfileBt,
        showProfileEt,
        showProfileRor,
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
    } = useRoastSettings();
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
    const machines = useMachines((s) => s.machines);
    const heaterUnit = profileHeaterBounds(session, machines, ROASTER_REGISTRY).unit;
    const eventMarkers = useMemo(() => {
        void resolvedTheme;
        const events = withEditedHeaterLog(parseStoredRoastEvents(session.events), session.heater_events, heaterUnit);
        return storedEventsToMarkers(events, unit);
    }, [session.events, session.heater_events, heaterUnit, unit, resolvedTheme]);
    const { points } = actual;
    const referenceCurve = useMemo(() => referenceCurveFromPoints(target.points), [target.points]);
    const displayedTarget = useMemo(() => toDisplayReferenceCurve(referenceCurve, unit), [referenceCurve, unit]);
    const referenceControls = referenceHasControls(referenceCurve);
    const heatSet = useMemo(
        () =>
            editedHeatSet(points, sessionDropTime(session), session.heater_events) ??
            points.map((p) => p.heaterSet ?? null),
        [points, session],
    );
    const sessionHasControls = points.some((p) => p.heater != null || p.fan != null || p.drum != null);
    const hasControls = sessionHasControls || referenceControls;
    const bbpRange =
        actual.bbpRange || target.bbpRange
            ? { start: Math.min(actual.bbpRange?.start ?? 0, target.bbpRange?.start ?? 0), end: 0 }
            : undefined;
    const chartRef = useRef<RoastTempChartHandle>(null);
    const { canExport, onExportPdf } = useHistoryPdfExport({
        session,
        chartRef,
        hasControls,
        hasTarget: target.points.length > 0,
        unit,
        canCapture: points.length > 0,
    });

    return (
        <section
            className="mt-3 rounded-lg border border-border-subtle bg-(--color-roast-bg) px-3 pt-3 pb-7"
            aria-label={t('history.title')}
        >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border-subtle pb-2 text-xs text-secondary">
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
                            {profile.name} · {t(targetBbp.isLoading ? 'bbp.loading' : 'bbp.failed')}
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
                    targetXs={displayedTarget.xs}
                    targetBt={displayedTarget.bt}
                    targetEt={displayedTarget.et}
                    targetRor={displayedTarget.ror}
                    showTargetCurve={showTargetCurve && target.points.length > 0}
                    showProfileBt={showProfileBt}
                    showProfileEt={showProfileEt}
                    showProfileRor={showProfileRor}
                    showProfileDrum={showProfileDrum}
                    showProfileHeat={showProfileHeat}
                    showProfileFan={showProfileFan}
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
                                  heatSet,
                                  reference: referenceControls
                                      ? {
                                            xs: displayedTarget.xs,
                                            drum: displayedTarget.drum,
                                            heater: displayedTarget.heater,
                                            fan: displayedTarget.fan,
                                        }
                                      : undefined,
                              }
                            : undefined
                    }
                    height={420}
                />
            )}
        </section>
    );
}
