import { ROASTER_REGISTRY, useMachines } from '@entities/machine';
import { useBbpCurve } from '@entities/roast';
import { type RoastProfileWithSource, resolveSourceSession } from '@entities/roast-profile';
import { computePhaseSegments, toDisplayRoR, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import { savedChartControls } from '@features/active-roast/lib/saved-chart-controls';
import { savedChartPresentation, savedControlsVisible } from '@features/active-roast/lib/saved-chart-presentation';
import {
    parseStoredRoastEvents,
    storedEventsToControlChanges,
    storedEventsToLogEntries,
    storedEventsToMarkers,
} from '@features/active-roast/lib/serialize-roast-events';
import { manualNotesToControlChanges, virtualControlLinesAllowed } from '@features/active-roast/lib/virtual-controls';
import { RoastTempChart } from '@features/active-roast/ui/RoastTempChart';
import { SavedCurveLegend } from '@features/active-roast/ui/SavedCurveLegend';
import { editedHeatSet, profileHeaterBounds, withEditedHeaterLog } from '@features/machine-control/lib/heater-events';
import { combineBbpCurve } from '@shared/lib/roast-curve';
import type { TsvPoint } from '@shared/lib/tsv';
import { ChartNoAxesCombined } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function ProfileRoastChart({
    profile,
    points: recordedPoints,
    events,
    isLoading,
    isError,
}: {
    profile: Pick<
        RoastProfileWithSource,
        'user_id' | 'source_session_id' | 'source_session' | 'duration_sec' | 'machine_id' | 'machine_roaster_key'
    >;
    points: TsvPoint[];
    events: unknown;
    isLoading: boolean;
    isError: boolean;
}) {
    const { t } = useTranslation();
    const settings = useRoastSettings();
    const unit = settings.temperatureUnit;
    const source = resolveSourceSession(profile.source_session);
    const machines = useMachines((state) => state.machines);
    const heaterUnit = profileHeaterBounds(
        source?.machine_id || source?.machine_roaster_key ? source : profile,
        machines,
        ROASTER_REGISTRY,
    ).unit;
    const bbp = useBbpCurve(profile.user_id, profile.source_session_id, source?.bbp_tsv_path);
    const actual = useMemo(() => {
        const points = isError ? [] : recordedPoints;
        return settings.bbpJoinCharge !== false
            ? combineBbpCurve(points, bbp.isError ? [] : (bbp.data ?? []), source?.bbp_seconds)
            : { points, bbpRange: undefined };
    }, [recordedPoints, isError, bbp.data, bbp.isError, source?.bbp_seconds, settings.bbpJoinCharge]);
    const { points } = actual;
    const storedEvents = useMemo(() => parseStoredRoastEvents(events), [events]);
    const eventMarkers = useMemo(
        () => storedEventsToMarkers(withEditedHeaterLog(storedEvents, source?.heater_events, heaterUnit), unit),
        [storedEvents, source?.heater_events, heaterUnit, unit],
    );
    const duration = source?.duration_seconds ?? profile.duration_sec;
    const dropTime = storedEvents.find((event) => event.type === 'Drop')?.time_sec ?? duration;
    const phases = useMemo(
        () => computePhaseSegments(storedEventsToLogEntries(storedEvents, unit), duration, true),
        [storedEvents, unit, duration],
    );
    const heatSet = useMemo(
        () => editedHeatSet(points, dropTime, source?.heater_events) ?? points.map((point) => point.heaterSet ?? null),
        [points, dropTime, source?.heater_events],
    );
    const { controlData } = savedChartControls({
        points,
        heatSet,
        heatSetUnit: heaterUnit,
        changes: [
            ...storedEventsToControlChanges(storedEvents),
            ...(settings.recordVirtualControls && virtualControlLinesAllowed(source?.machine_roaster_key)
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
        referenceControls: false,
        displayedTarget: { xs: [], drum: [], heater: [], fan: [] },
    });
    const showControls = savedControlsVisible(controlData, settings, false);
    const status = isLoading
        ? 'history.expanded.chartLoading'
        : isError
          ? 'history.expanded.chartUnavailable'
          : !recordedPoints.length
            ? 'profiles.detail.noRecordedData'
            : null;

    return (
        <section
            className="mb-5 min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-(--color-roast-bg) px-5 pt-5 pb-4"
            aria-label={t('profiles.detail.profileCurve')}
            aria-busy={isLoading}
        >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <h3 className="text-xs font-medium text-muted">{t('profiles.detail.profileCurve')}</h3>
                <SavedCurveLegend points={points} settings={settings} />
            </div>
            {status ? (
                <div
                    role="status"
                    className="flex min-h-56 flex-col items-center justify-center gap-3 text-[13px] text-muted"
                >
                    <ChartNoAxesCombined size={28} strokeWidth={1} className="opacity-50" />
                    {t(status)}
                </div>
            ) : (
                <RoastTempChart
                    {...savedChartPresentation(settings)}
                    xs={points.map((point) => point.t)}
                    btActual={points.map((point) => toDisplayTemp(point.bt, unit))}
                    etActual={points.map((point) => (point.et == null ? null : toDisplayTemp(point.et, unit)))}
                    rorActual={points.map((point) => (point.ror == null ? null : toDisplayRoR(point.ror, unit)))}
                    rorEtActual={points.map((point) => (point.rorEt == null ? null : toDisplayRoR(point.rorEt, unit)))}
                    btTarget={[]}
                    showTargetCurve={false}
                    currentTimeSec={0}
                    eventMarkers={eventMarkers}
                    machineId={source?.machine_id}
                    xViewMin={actual.bbpRange?.start ?? 0}
                    xViewMax={Math.max(1, duration, points[points.length - 1]?.t ?? 0)}
                    showControlTailLabels={false}
                    bbpRange={actual.bbpRange}
                    controlData={showControls ? controlData : undefined}
                    phaseSegments={settings.showPhaseBar ? phases : []}
                    height={showControls ? 440 : 360}
                />
            )}
            {source?.bbp_tsv_path && (bbp.isLoading || bbp.isError) && (
                <p role="status" className="mt-2 text-xs text-muted">
                    {t(bbp.isLoading ? 'bbp.loading' : 'bbp.failed')}
                </p>
            )}
        </section>
    );
}
