import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { parseHeaterEvents, type ReplayPlanSource } from '@features/machine-control/lib/heater-events';
import {
    eventTrigger,
    extractReplayEvents,
    type ReplayEvent,
    type ReplayPoint,
} from '@features/machine-control/lib/replay';

type SessionHeat = { events: unknown; heater_events: unknown; duration_seconds: number | null };

/** Replay cutoff = Drop mark (same rule as ActiveRoast); End only when Drop is missing. */
export const sessionDropTime = (session: Pick<SessionHeat, 'events' | 'duration_seconds'>): number | null =>
    parseStoredRoastEvents(session.events).find((e) => e.type === 'Drop')?.time_sec ?? session.duration_seconds ?? null;

/** Same steps up to the editor's 0.1° display round-trip of BT. */
export const sameHeatPlan = (a: ReplayEvent[], b: ReplayEvent[], tpTime: number): boolean =>
    a.length === b.length &&
    a.every(
        (e, i) =>
            e.t === b[i].t &&
            e.heater === b[i].heater &&
            eventTrigger(e, tpTime) === eventTrigger(b[i], tpTime) &&
            Math.abs(e.bt - b[i].bt) < 0.1,
    );

/** Heat set rows for a saved record: edited plan, else the recorded TSV steps. */
export const sessionHeatPlan = (
    session: SessionHeat,
    points: ReplayPoint[],
): { events: ReplayEvent[]; recorded: ReplayEvent[]; tpTime: number; source: ReplayPlanSource | null } => {
    const extracted = points.length > 0 ? extractReplayEvents(points, sessionDropTime(session)) : null;
    const stored = session.heater_events == null ? null : parseHeaterEvents(session.heater_events);
    const storedInvalid = session.heater_events != null && stored == null;
    const recorded = extracted?.events ?? [];
    return {
        events: storedInvalid ? [] : (stored ?? recorded),
        recorded,
        tpTime: extracted?.tpTime ?? Number.POSITIVE_INFINITY,
        source: stored || storedInvalid ? 'session' : extracted ? 'tsv' : null,
    };
};
