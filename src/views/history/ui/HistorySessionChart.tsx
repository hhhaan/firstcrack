import { ROASTER_REGISTRY, useMachines } from '@entities/machine';
import { useBbpCurve, useHistoryChart } from '@entities/roast';
import { resolveSourceSession, useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import {
    computePhaseSegments,
    formatTemp,
    type TemperatureUnit,
    toDisplayRoR,
    toDisplayTemp,
    useRoastingStore,
    useRoastSettings,
} from '@features/active-roast';
import type { EventMarkerPatch } from '@features/active-roast/lib/event-marker-drag';
import { dropStoredControlRole, patchStoredControl } from '@features/active-roast/lib/fan-drum-markers';
import {
    referenceCurveFromPoints,
    referenceHasControls,
    toDisplayReferenceCurve,
} from '@features/active-roast/lib/reference-curve';
import { savedChartControls } from '@features/active-roast/lib/saved-chart-controls';
import { savedChartPresentation, savedControlsVisible } from '@features/active-roast/lib/saved-chart-presentation';
import {
    parseStoredRoastEvents,
    patchStoredNoteEvent,
    storedEventsToControlChanges,
    storedEventsToLogEntries,
    storedEventsToMarkers,
} from '@features/active-roast/lib/serialize-roast-events';
import { manualNotesToControlChanges, virtualControlLinesAllowed } from '@features/active-roast/lib/virtual-controls';
import { RoastTempChart, type RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import { SavedCurveLegend } from '@features/active-roast/ui/SavedCurveLegend';
import {
    editedHeatSet,
    patchHeaterPlanMarker,
    patchStoredHeaterEvent,
    profileHeaterBounds,
    withEditedHeaterLog,
} from '@features/machine-control/lib/heater-events';
import { formatDuration } from '@shared/lib/format';
import { combineBbpCurve } from '@shared/lib/roast-curve';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { useThemeStore } from '@shared/store/theme';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { ChartNoAxesCombined, Check, FileDown } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useHistoryPdfExport } from '../hooks/useHistoryPdfExport';
import { useRoastRecordSave } from '../hooks/useRoastRecordSave';
import { sessionDropTime } from '../lib/record-heat';
import {
    curveStatusKey,
    historyPrintTempBounds,
    historyTargetVisible,
    historyXView,
    mergedBbpRange,
    orNull,
    profileForSession,
    referenceStatusKey,
    roastChartStatusKey,
} from '../lib/session-chart-view';

function ChartMeta({
    session,
    unit,
    bbpStatus,
    roastStatus,
    referenceStatus,
    hasPoints,
}: {
    session: RoastSessionWithRelations;
    unit: TemperatureUnit;
    bbpStatus: string | null;
    roastStatus: string | null;
    referenceStatus: { name: string; key: string } | null;
    hasPoints: boolean;
}) {
    const { t } = useTranslation();
    const showBbp = session.bbp_seconds != null || Boolean(session.bbp_tsv_path);
    const showCharge = session.charge_temp_celsius != null;
    const showRoast = Boolean(roastStatus) && hasPoints;
    if (!showBbp && !showCharge && !showRoast && !referenceStatus) return null;
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            {showBbp && (
                <span>
                    {t('bbp.duration')}: {formatDuration(session.bbp_seconds)}
                </span>
            )}
            {showCharge && (
                <span>
                    {t('bbp.chargeTemp')}: {formatTemp(session.charge_temp_celsius, unit)}
                </span>
            )}
            {bbpStatus && session.bbp_tsv_path && <output>{t(bbpStatus)}</output>}
            {showRoast && roastStatus && <output>{t(roastStatus)}</output>}
            {referenceStatus && (
                <output>
                    {referenceStatus.name} · {t(referenceStatus.key)}
                </output>
            )}
        </div>
    );
}

// Temporarily hidden under the history chart.
// function PhaseShare({ phases }: { phases: PhaseSegment[] }) {
//     const { t } = useTranslation();
//     if (phases.length <= 1) return null;
//     return (
//         <div className="mt-4 border-t border-border-subtle pt-4">
//             <div aria-hidden="true" className="mb-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
//                 {phases.map((phase) => (
//                     <span key={phase.name} style={{ flex: phase.durationSec, backgroundColor: phase.color }} />
//                 ))}
//             </div>
//             <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}>
//                 {phases.map((phase) => (
//                     <div key={phase.name} className="min-w-0">
//                         <div className="mb-1 text-[11px] text-muted">{t(`history.compare.phase${phase.name}`)}</div>
//                         <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[13px] text-primary">
//                             {formatDuration(phase.durationSec)}
//                             <span className="text-[11px] text-muted">{phase.pct}%</span>
//                         </div>
//                     </div>
//                 ))}
//             </div>
//         </div>
//     );
// }

export function HistorySessionChart({
    session,
    exportContainer,
}: {
    session: RoastSessionWithRelations;
    exportContainer: HTMLElement | null;
}) {
    const { t } = useTranslation();
    const settings = useRoastSettings();
    const {
        temperatureUnit: unit,
        eventMarkerStyle,
        showTargetCurve,
        showProfileBt,
        showProfileEt,
        showProfileRor,
        showProfileEtRor,
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
        recordVirtualControls,
    } = settings;
    const [joinBbp, setJoinBbp] = useState(true);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const roast = useHistoryChart(orNull(session.tsv_path));
    const bbp = useBbpCurve(session.user_id, session.id, session.bbp_tsv_path);
    const { data: profiles = [] } = useRoastProfiles(session.user_id);
    const profile = profileForSession(profiles, session);
    const source = resolveSourceSession(profile?.source_session);
    const { points: resolvedTargetPoints, source: targetSource } = useResolvedProfileCurve(profile);
    const targetPoints = targetSource === 'synthetic' ? [] : resolvedTargetPoints;
    const targetBbp = useBbpCurve(session.user_id, orNull(profile?.source_session_id), source?.bbp_tsv_path);
    const hasBbpSource = Boolean(session.bbp_tsv_path || source?.bbp_tsv_path);
    const hasBbpData =
        (!bbp.isLoading && !bbp.isError && Boolean(bbp.data?.length)) ||
        (!targetBbp.isLoading && !targetBbp.isError && Boolean(targetBbp.data?.length));
    const actual = useMemo(() => {
        const points = roast.isError ? [] : roast.points;
        return joinBbp
            ? combineBbpCurve(points, bbp.isError ? [] : (bbp.data ?? []), session.bbp_seconds)
            : { points, bbpRange: undefined };
    }, [roast.points, roast.isError, bbp.data, bbp.isError, session.bbp_seconds, joinBbp]);
    const target = useMemo(() => {
        const bbpPoints = targetBbp.isError ? [] : (targetBbp.data ?? []);
        return joinBbp
            ? combineBbpCurve(targetPoints, bbpPoints, source?.bbp_seconds)
            : { points: targetPoints, bbpRange: undefined };
    }, [targetPoints, targetBbp.data, targetBbp.isError, source?.bbp_seconds, joinBbp]);
    const machines = useMachines((s) => s.machines);
    const heaterUnit = profileHeaterBounds(session, machines, ROASTER_REGISTRY).unit;
    const record = useRoastRecordSave(session);
    const [markerError, setMarkerError] = useState<string | null>(null);
    const onEventMarkerEdit = useCallback(
        (logId: string, patch: EventMarkerPatch) => {
            const control = patchStoredControl(session.events, logId, patch);
            const plan = control ? null : patchHeaterPlanMarker(session.heater_events, logId, patch);
            const events = control || plan ? null : patchStoredHeaterEvent(session.events, logId, patch);
            const noted = control || plan || events ? null : patchStoredNoteEvent(session.events, logId, patch);
            const next = control ?? events ?? noted;
            if (plan) {
                void record.saveHeater(plan).then(
                    () => setMarkerError(null),
                    (error: unknown) => setMarkerError(record.errorText(error)),
                );
                return;
            }
            if (!next) return;
            void record.saveEvents(next).then(
                () => setMarkerError(null),
                (error: unknown) => setMarkerError(record.errorText(error)),
            );
        },
        [record, session.events, session.heater_events],
    );
    const onEventMarkerDelete = useCallback(
        (logId: string) => {
            const next = dropStoredControlRole(session.events, logId);
            if (!next) return;
            void record.saveEvents(next).then(
                () => setMarkerError(null),
                (error: unknown) => setMarkerError(record.errorText(error)),
            );
        },
        [record, session.events],
    );
    const storedEvents = useMemo(() => parseStoredRoastEvents(session.events), [session.events]);
    const eventMarkers = useMemo(() => {
        void resolvedTheme;
        const events = withEditedHeaterLog(storedEvents, session.heater_events, heaterUnit);
        return storedEventsToMarkers(events, unit);
    }, [storedEvents, session.heater_events, heaterUnit, unit, resolvedTheme]);
    const { points } = actual;
    const phases = useMemo(
        () =>
            computePhaseSegments(
                storedEventsToLogEntries(storedEvents, unit),
                sessionRoastMetrics(session).roastDurationSec ?? 0,
                true,
            ),
        [storedEvents, unit, session],
    );
    const referenceCurve = useMemo(() => referenceCurveFromPoints(target.points), [target.points]);
    const displayedTarget = useMemo(() => toDisplayReferenceCurve(referenceCurve, unit), [referenceCurve, unit]);
    const targetVisible = historyTargetVisible(showTargetCurve, target.points.length);
    // The PDF historically fitted all samples, including a synthetic reference when enabled.
    // Keep that print policy separate from the measured-only reference shown on screen.
    const printTarget = useMemo(
        () =>
            joinBbp
                ? combineBbpCurve(
                      resolvedTargetPoints,
                      targetBbp.isError ? [] : (targetBbp.data ?? []),
                      source?.bbp_seconds,
                  ).points
                : resolvedTargetPoints,
        [joinBbp, resolvedTargetPoints, targetBbp.isError, targetBbp.data, source?.bbp_seconds],
    );
    const printTempBounds = historyPrintTempBounds(
        points,
        printTarget,
        historyTargetVisible(showTargetCurve, printTarget.length) ? { bt: showProfileBt, et: showProfileEt } : null,
        settings.tempMinC,
        settings.tempMaxC,
    );
    const referenceControls = referenceHasControls(referenceCurve);
    const heatSet = useMemo(
        () =>
            editedHeatSet(points, sessionDropTime(session), session.heater_events) ??
            points.map((p) => p.heaterSet ?? null),
        [points, session],
    );
    const { controlData } = savedChartControls({
        changes: [
            ...storedEventsToControlChanges(storedEvents),
            ...(recordVirtualControls && virtualControlLinesAllowed(session.machine_roaster_key)
                ? manualNotesToControlChanges(
                      storedEvents.map((event) => ({
                          event: event.type,
                          timeSec: event.time_sec,
                          gas: event.gas,
                          airflow: event.airflow,
                          drum: event.drum,
                      })),
                  )
                : []),
        ],
        points,
        heatSet,
        heatSetUnit: heaterUnit,
        referenceControls,
        displayedTarget,
    });
    const showControlBand = savedControlsVisible(controlData, settings, targetVisible);
    const bbpRange = mergedBbpRange(actual.bbpRange, target.bbpRange);
    const xView = historyXView({
        bbpStart: bbpRange?.start,
        durationSec: session.duration_seconds,
        lastT: points[points.length - 1]?.t,
        targetT: target.points[target.points.length - 1]?.t,
    });
    const bbpStatus = curveStatusKey({
        isLoading: bbp.isLoading,
        isError: bbp.isError,
        empty: !bbp.data?.length,
    });
    const roastStatus = roastChartStatusKey(roast.isLoading, roast.isError);
    const referenceStatus = referenceStatusKey(orNull(profile?.name), targetBbp.isLoading, targetBbp.isError);
    const chartRef = useRef<RoastTempChartHandle>(null);
    // 로스팅 중 PDF 비활성화는 임시. 나중에 변경 예정.
    const roasting = useRoastingStore((s) => s.phase === 'roasting');
    const { canExport, onExportPdf } = useHistoryPdfExport({
        session,
        chartRef,
        canCapture: points.length > 0,
        roasting,
    });

    return (
        <section
            className="min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-(--color-roast-bg) px-5 pt-5 pb-4"
            aria-label={t('history.compare.tempAndRor')}
        >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                    {hasBbpSource && (
                        <SurfaceButton
                            aria-pressed={joinBbp}
                            disabled={!hasBbpData}
                            onClick={() => setJoinBbp((shown) => !shown)}
                            icon={
                                <Check
                                    size={14}
                                    strokeWidth={2}
                                    aria-hidden="true"
                                    className={joinBbp ? '' : 'invisible'}
                                />
                            }
                            className="focus-visible:outline-action aria-pressed:border-transparent aria-pressed:bg-action aria-pressed:text-on-action aria-pressed:hover:bg-action aria-pressed:hover:opacity-85"
                        >
                            {t('history.showBbp')}
                        </SurfaceButton>
                    )}
                    <ChartMeta
                        session={session}
                        unit={unit}
                        bbpStatus={bbpStatus}
                        roastStatus={roastStatus}
                        referenceStatus={referenceStatus}
                        hasPoints={points.length > 0}
                    />
                </div>
                {exportContainer &&
                    createPortal(
                        <button
                            type="button"
                            data-testid="history-export-pdf"
                            onClick={() => void onExportPdf()}
                            disabled={!canExport}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-transparent bg-palette-black px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-palette-black/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <FileDown size={14} strokeWidth={2} />
                            {t('history.exportPdf')}
                        </button>,
                        exportContainer,
                    )}
                <SavedCurveLegend
                    points={points}
                    settings={settings}
                    showTarget={
                        targetVisible &&
                        (showProfileBt ||
                            (showProfileEt && target.points.some((p) => p.et != null)) ||
                            (showProfileRor && target.points.some((p) => p.ror != null)) ||
                            (showProfileEtRor && displayedTarget.rorEt.some((value) => value != null)))
                    }
                    profileName={profile?.name || t('history.table.profile')}
                />
            </div>
            {points.length > 0 && (
                <RoastTempChart
                    {...savedChartPresentation(settings)}
                    ref={chartRef}
                    showTooltip={false}
                    xs={points.map((p) => p.t)}
                    btActual={points.map((p) => toDisplayTemp(p.bt, unit))}
                    etActual={points.map((p) => (p.et == null ? null : toDisplayTemp(p.et, unit)))}
                    rorActual={points.map((p) => (p.ror == null ? null : toDisplayRoR(p.ror, unit)))}
                    rorEtActual={points.map((p) => (p.rorEt == null ? null : toDisplayRoR(p.rorEt, unit)))}
                    btTarget={[]}
                    targetXs={displayedTarget.xs}
                    targetBt={displayedTarget.bt}
                    targetEt={displayedTarget.et}
                    targetRor={displayedTarget.ror}
                    targetEtRor={displayedTarget.rorEt}
                    showTargetCurve={targetVisible}
                    showProfileBt={showProfileBt}
                    showProfileEt={showProfileEt}
                    showProfileRor={showProfileRor}
                    showProfileEtRor={showProfileEtRor}
                    showProfileDrum={showProfileDrum}
                    showProfileHeat={showProfileHeat}
                    showProfileFan={showProfileFan}
                    currentTimeSec={0}
                    eventMarkerStyle={eventMarkerStyle}
                    eventMarkers={eventMarkers}
                    onEventMarkerEdit={record.canWrite ? onEventMarkerEdit : undefined}
                    onEventMarkerDelete={record.canWrite ? onEventMarkerDelete : undefined}
                    machineId={session.machine_id}
                    temperatureUnit={unit}
                    xViewMin={xView.min}
                    xViewMax={xView.max}
                    showControlTailLabels={false}
                    bbpRange={bbpRange}
                    controlData={showControlBand ? controlData : undefined}
                    printControlData={controlData}
                    printTempBounds={printTempBounds}
                    phaseSegments={settings.showPhaseBar ? phases : []}
                    height={showControlBand ? 440 : 360}
                />
            )}
            {markerError && (
                <p role="alert" className="mt-2 text-xs text-error">
                    {markerError}
                </p>
            )}
            {points.length === 0 && (
                <div
                    className="flex min-h-56 flex-col items-center justify-center gap-3 text-[13px] text-muted"
                    role="status"
                >
                    <ChartNoAxesCombined size={28} strokeWidth={1} className="opacity-50" />
                    {t(roastStatus || 'history.compare.noCurveData')}
                </div>
            )}
            {/* <PhaseShare phases={phases} /> */}
        </section>
    );
}
