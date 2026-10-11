/**
 * Chart-only preheat lives in the Zustand store, which outlives a React remount.
 * bootMs only catches a store left over from before this module evaluated (HMR).
 * A new Active Roast mount — fresh tree, dashboard initial view, same document —
 * gets a new epoch so that curve restarts even when startMs is still newer than bootMs.
 * Sidebar navigation does not remount Active Roast (the shell hides it and toggles
 * isActive), so the epoch stays put and the poll loop keeps appending. A reload
 * restarts the curve, even on the same epoch: chart-only samples are not stored,
 * so a surviving JS realm would otherwise
 * keep the old startMs. A recorded Charge wait is never restarted.
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

export type ChartOnlyPreheatDecision = 'begin' | 'keep';

type ChartOnlyPreheatInput = {
    visible: boolean;
    bbp: { active: boolean; recording: boolean; startMs: number };
    bootMs: number;
    mountEpoch?: number;
    phase: string;
    awaitingNextCharge: boolean;
    bbpEnabled: boolean;
    navigationType?: string;
    /** This document already restarted chart-only preheat for a reload. */
    reloadConsumed?: boolean;
};

/**
 * Chart-only preheat keeps collecting across sidebar navigation; reload starts a new curve.
 * Recorded Charge wait (recording or awaiting the next Charge) is left alone, including
 * across hide and reload.
 */
export const chartOnlyPreheatDecision = (input: ChartOnlyPreheatInput): ChartOnlyPreheatDecision => {
    const recorded = input.bbp.recording || input.awaitingNextCharge;
    if (!input.visible) return 'keep';
    if (!input.bbpEnabled || recorded) return 'keep';
    if (input.phase !== 'preheating' && input.phase !== 'standby') return 'keep';
    if (input.navigationType === 'reload' && !input.reloadConsumed) return 'begin';
    if (!shouldStartChartOnlyPreheat(input.bbp, input.bootMs, input.mountEpoch)) return 'keep';
    return 'begin';
};
