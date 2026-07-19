export type RoastAlertKind = 'ror-crash' | 'bt-over';

export type RoastAlertThresholds = {
    /** Fire when BT RoR falls to or below this (°C/min). */
    rorCrashBelowCPerMin: number;
    /** Fire when BT reaches or exceeds this (°C). */
    btMaxC: number;
};

export type RoastAlertInput = {
    ror: number | null;
    bt: number | null;
    /** RoR is legitimately negative between charge and turning point — don't call that a crash. */
    afterTurningPoint: boolean;
};

/**
 * Re-arm margin. A reading hovering on the threshold would otherwise fire on every poll;
 * an alert stays active until it recovers past threshold + margin.
 */
const HYSTERESIS = { ror: 1.5, bt: 3 } as const;

const holds = (kind: RoastAlertKind, input: RoastAlertInput, t: RoastAlertThresholds, wasActive: boolean): boolean => {
    if (kind === 'ror-crash') {
        if (!input.afterTurningPoint || input.ror == null) return false;
        return input.ror <= (wasActive ? t.rorCrashBelowCPerMin + HYSTERESIS.ror : t.rorCrashBelowCPerMin);
    }
    if (input.bt == null) return false;
    return input.bt >= (wasActive ? t.btMaxC - HYSTERESIS.bt : t.btMaxC);
};

const ALL_KINDS: RoastAlertKind[] = ['ror-crash', 'bt-over'];

/**
 * Alert kinds whose condition holds right now.
 *
 * @param active kinds active on the previous tick — feed the result back in so hysteresis applies.
 */
export const evaluateRoastAlerts = (
    input: RoastAlertInput,
    thresholds: RoastAlertThresholds,
    active: readonly RoastAlertKind[] = [],
): RoastAlertKind[] => ALL_KINDS.filter((kind) => holds(kind, input, thresholds, active.includes(kind)));
