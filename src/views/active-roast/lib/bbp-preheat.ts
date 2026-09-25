/** Chart caption: recorded Charge wait is since the previous End. First-batch preheat is not. */
export const bbpTimeOriginKey = (recording: boolean): 'bbp.timeOrigin' | 'bbp.preheatTimeOrigin' =>
    recording ? 'bbp.timeOrigin' : 'bbp.preheatTimeOrigin';

/**
 * Chart-only preheat lives in the Zustand store, which outlives a React remount.
 * bootMs only catches a store left over from before this module evaluated (HMR).
 * A new Active Roast mount — fresh tree, dashboard initial view, same document —
 * gets a new epoch so that curve restarts even when startMs is still newer than bootMs.
 * A recorded Charge wait is never restarted.
 */
let chartOnlyMountEpoch = 0;
let nextPreheatMountEpoch = 0;

export const takePreheatMountEpoch = (): number => ++nextPreheatMountEpoch;

export const noteChartOnlyPreheatMount = (mountEpoch: number) => {
    chartOnlyMountEpoch = mountEpoch;
};

export const resetChartOnlyPreheatMountsForTests = () => {
    chartOnlyMountEpoch = 0;
    nextPreheatMountEpoch = 0;
};

export const shouldStartChartOnlyPreheat = (
    bbp: { active: boolean; recording: boolean; startMs: number },
    bootMs: number,
    mountEpoch?: number,
): boolean => {
    if (bbp.active && bbp.recording) return false;
    const sameMount = mountEpoch === undefined || mountEpoch === chartOnlyMountEpoch;
    if (bbp.active && bbp.startMs >= bootMs && sameMount) return false;
    return true;
};

/**
 * bfcache restores the chart-only curve in memory. A reload navigation does too
 * when the JS realm survived (phase still preheating) — persisted is false then.
 * Charge wait stays recorded.
 */
export const shouldResetChartOnlyPreheatOnPageRestore = (
    persisted: boolean,
    bbp: { recording: boolean },
    phase: string,
    awaitingNextCharge: boolean,
    navigationType?: string,
): boolean => {
    const chartOnly = !bbp.recording && !awaitingNextCharge && (phase === 'preheating' || phase === 'standby');
    if (!chartOnly) return false;
    return persisted || navigationType === 'reload';
};
