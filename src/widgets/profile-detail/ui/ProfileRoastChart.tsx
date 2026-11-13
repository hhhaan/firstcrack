import { useBbpCurve } from '@entities/roast';
import { type RoastProfileWithSource, resolveSourceSession } from '@entities/roast-profile';
import { toDisplayRoR, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import { savedChartPresentation } from '@features/active-roast/lib/saved-chart-presentation';
import { parseStoredRoastEvents, storedEventsToMarkers } from '@features/active-roast/lib/serialize-roast-events';
import { RoastTempChart } from '@features/active-roast/ui/RoastTempChart';
import { SavedCurveLegend } from '@features/active-roast/ui/SavedCurveLegend';
import { combineBbpCurve, curveThroughDrop } from '@shared/lib/roast-curve';
import type { TsvPoint } from '@shared/lib/tsv';
import { ChartNoAxesCombined } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ProfileRoastChart({
    profile,
    points: recordedPoints,
    events,
    isLoading,
    isError,
    sessionTitle,
}: {
    profile: Pick<RoastProfileWithSource, 'user_id' | 'source_session_id' | 'source_session' | 'duration_sec'>;
    points: TsvPoint[];
    events: unknown;
    isLoading: boolean;
    isError: boolean;
    sessionTitle?: string | null;
}) {
    const { t } = useTranslation();
    const sectionRef = useRef<HTMLElement>(null);
    const [chartHeight, setChartHeight] = useState(360);
    useEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        const apply = (width: number) => setChartHeight(width < 520 ? 260 : 360);
        apply(section.clientWidth);
        const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width;
            if (width) apply(width);
        });
        observer.observe(section);
        return () => observer.disconnect();
    }, []);
    const settings = useRoastSettings();
    const unit = settings.temperatureUnit;
    const source = resolveSourceSession(profile.source_session);
    const bbp = useBbpCurve(profile.user_id, profile.source_session_id, source?.bbp_tsv_path);
    const actual = useMemo(() => {
        const points = isError ? [] : curveThroughDrop(recordedPoints, events);
        return settings.bbpJoinCharge !== false
            ? combineBbpCurve(points, bbp.isError ? [] : (bbp.data ?? []), source?.bbp_seconds)
            : { points, bbpRange: undefined };
    }, [recordedPoints, events, isError, bbp.data, bbp.isError, source?.bbp_seconds, settings.bbpJoinCharge]);
    const { points } = actual;
    const storedEvents = useMemo(() => parseStoredRoastEvents(events), [events]);
    const eventMarkers = useMemo(
        () =>
            storedEventsToMarkers(
                storedEvents.flatMap(({ id, type, time_sec, temp_c, note }) => {
                    if (['Heater', 'Control', 'Fan', 'Drum'].includes(type) || (type === 'Note' && !note?.trim()))
                        return [];
                    return [{ id, type, time_sec, temp_c, note }];
                }),
                unit,
            ),
        [storedEvents, unit],
    );
    const duration = source?.duration_seconds ?? profile.duration_sec ?? 0;
    const status = isLoading
        ? 'history.expanded.chartLoading'
        : isError
          ? 'history.expanded.chartUnavailable'
          : !recordedPoints.length
            ? 'profiles.detail.noRecordedData'
            : null;

    return (
        <section
            ref={sectionRef}
            className="@container mb-5 min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-(--color-roast-bg) px-4 pt-3 pb-2 @xl:px-5"
            aria-label={t('profiles.detail.profileCurve')}
            aria-busy={isLoading}
        >
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <div className="min-w-0">
                    <h3 className="text-xs font-medium text-muted">{t('profiles.detail.profileCurve')}</h3>
                    {sessionTitle && (
                        <p
                            className="truncate text-sm font-medium leading-5 text-primary"
                            data-testid="profile-curve-session-title"
                        >
                            {sessionTitle}
                        </p>
                    )}
                </div>
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
                    showTargetCurve={false}
                    showTooltip={false}
                    currentTimeSec={0}
                    eventMarkers={eventMarkers}
                    xViewMin={actual.bbpRange?.start ?? 0}
                    xViewMax={Math.max(1, duration, points[points.length - 1]?.t ?? 0)}
                    bbpRange={actual.bbpRange}
                    fontScale={11 / 12}
                    height={chartHeight}
                    layoutMinHeight={chartHeight}
                    gridBottom={32}
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
