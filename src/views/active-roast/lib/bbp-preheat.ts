/** Chart caption: recorded Charge wait is since the previous End. First-batch preheat is not. */
export const bbpTimeOriginKey = (recording: boolean): 'bbp.timeOrigin' | 'bbp.preheatTimeOrigin' =>
    recording ? 'bbp.timeOrigin' : 'bbp.preheatTimeOrigin';

/**
 * Start a chart-only preheat when this document has no in-memory session.
 * A recorded Charge wait (including one just hydrated) must keep running.
 * ponytail: bootMs is the Active Roast module load time. A chart-only store that
 * survived HMR has an older startMs and is restarted. bfcache does not re-evaluate
 * modules; pageshow handles that path.
 */
export const shouldStartChartOnlyPreheat = (
    bbp: { active: boolean; recording: boolean; startMs: number },
    bootMs: number,
): boolean => {
    if (bbp.active && bbp.recording) return false;
    if (bbp.active && bbp.startMs >= bootMs) return false;
    return true;
};

/** bfcache restores the chart-only curve in memory. Charge wait stays recorded. */
export const shouldResetChartOnlyPreheatOnPageRestore = (
    persisted: boolean,
    bbp: { recording: boolean },
    phase: string,
    awaitingNextCharge: boolean,
): boolean => persisted && !bbp.recording && !awaitingNextCharge && (phase === 'preheating' || phase === 'standby');
