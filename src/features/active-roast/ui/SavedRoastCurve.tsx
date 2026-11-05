import type { TsvPoint } from '@shared/lib/tsv';
import { computePhaseSegments } from '../lib/phases';
import { savedChartPresentation } from '../lib/saved-chart-presentation';
import { parseStoredRoastEvents, storedEventsToLogEntries, storedEventsToMarkers } from '../lib/serialize-roast-events';
import { toDisplayRoR, toDisplayTemp } from '../lib/temperature';
import { useRoastSettings } from '../model/settings';
import { RoastTempChart } from './RoastTempChart';
import { SavedCurveLegend } from './SavedCurveLegend';

/** A read-only view of the saved samples, with the same scales and styles as History. */
export function SavedRoastCurve({ points, events }: { points: TsvPoint[]; events?: unknown }) {
    const settings = useRoastSettings();
    const unit = settings.temperatureUnit;
    const stored = parseStoredRoastEvents(events);
    const end = points[points.length - 1]?.t ?? 0;
    const missing = [
        { label: 'ET', enabled: settings.showET, key: 'et' as const },
        { label: 'RoR', enabled: settings.showRoRChart, key: 'ror' as const },
        { label: 'ET RoR', enabled: settings.showRoRET, key: 'rorEt' as const },
    ].filter((channel) => channel.enabled && !points.some((point) => point[channel.key] != null));
    return (
        <div data-testid="profile-saved-curve" className="min-w-0">
            <SavedCurveLegend points={points} settings={settings} />
            {missing.length > 0 && (
                <p className="mt-1 text-xs text-muted" data-testid="profile-missing-channels">
                    {missing.map((channel) => `${channel.label} · —`).join(' / ')}
                </p>
            )}
            <RoastTempChart
                {...savedChartPresentation(settings)}
                xs={points.map((p) => p.t)}
                btActual={points.map((p) => toDisplayTemp(p.bt, unit))}
                etActual={points.map((p) => (p.et == null ? null : toDisplayTemp(p.et, unit)))}
                rorActual={points.map((p) => (p.ror == null ? null : toDisplayRoR(p.ror, unit)))}
                rorEtActual={points.map((p) => (p.rorEt == null ? null : toDisplayRoR(p.rorEt, unit)))}
                btTarget={[]}
                showTargetCurve={false}
                currentTimeSec={end}
                eventMarkers={storedEventsToMarkers(stored, unit)}
                phaseSegments={
                    settings.showPhaseBar ? computePhaseSegments(storedEventsToLogEntries(stored, unit), end, true) : []
                }
                xViewMin={Math.min(0, points[0]?.t ?? 0)}
                xViewMax={Math.max(1, end)}
                height={320}
            />
        </div>
    );
}
