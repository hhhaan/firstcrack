export type RoastAlertKind = 'ror-crash' | 'bt-over' | 'after-charge' | 'before-fc' | 'before-drop' | 'after-drop';

export type TimeAlertKind = Exclude<RoastAlertKind, 'ror-crash' | 'bt-over'>;

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

/** Minutes; `null` = that alarm is off. */
export type TimeAlertConfig = {
    afterChargeMin: number | null;
    beforeFcMin: number | null;
    beforeDropMin: number | null;
    afterDropMin: number | null;
};

export type TimeAlertInput = {
    elapsedSec: number;
    /** Drop or End already marked — charge/FC/drop-before alarms stay silent. */
    dropped: boolean;
    /** Target profile `FC Start` time_sec. Null → before-FC is a no-op. */
    referenceFcStartSec: number | null;
    /** Target profile `Drop` time_sec. Null → before-drop is a no-op. */
    referenceDropSec: number | null;
    /** Current session Drop time_sec. Null → after-drop is a no-op. */
    sessionDropSec: number | null;
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

const dueAfter = (elapsedSec: number, originSec: number, offsetMin: number): boolean =>
    elapsedSec >= originSec + offsetMin * 60;

const dueBefore = (elapsedSec: number, eventSec: number, offsetMin: number): boolean => {
    const fireAt = eventSec - offsetMin * 60;
    return elapsedSec >= fireAt && elapsedSec < eventSec;
};

/**
 * Time / reference-event alarms. Fire once on the rising edge (no hysteresis):
 * the kind stays in the result while the window holds, then drops off.
 */
export const evaluateTimeAlerts = (input: TimeAlertInput, config: TimeAlertConfig): TimeAlertKind[] => {
    const out: TimeAlertKind[] = [];
    if (!input.dropped && config.afterChargeMin != null && dueAfter(input.elapsedSec, 0, config.afterChargeMin)) {
        out.push('after-charge');
    }
    if (
        !input.dropped &&
        config.beforeFcMin != null &&
        input.referenceFcStartSec != null &&
        dueBefore(input.elapsedSec, input.referenceFcStartSec, config.beforeFcMin)
    ) {
        out.push('before-fc');
    }
    if (
        !input.dropped &&
        config.beforeDropMin != null &&
        input.referenceDropSec != null &&
        dueBefore(input.elapsedSec, input.referenceDropSec, config.beforeDropMin)
    ) {
        out.push('before-drop');
    }
    if (
        input.dropped &&
        config.afterDropMin != null &&
        input.sessionDropSec != null &&
        dueAfter(input.elapsedSec, input.sessionDropSec, config.afterDropMin)
    ) {
        out.push('after-drop');
    }
    return out;
};
