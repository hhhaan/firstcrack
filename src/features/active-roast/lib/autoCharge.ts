import { createBtFilter } from '@shared/lib/btFilter';

export type AutoDetectMode = 'standard' | 'sensitive';
export type AutoChargeMode = AutoDetectMode;
export type AutoDropMode = AutoDetectMode;
export type RawTemperatureSample = {
    timestamp: number; // sidecar monotonic seconds; never Unix time
    receivedAtMs: number; // frontend Date.now(), captured on response
    bt: number;
};

type BtBreakKind = 'charge' | 'drop';
type PollMs = 500 | 1000;

/**
 * Artisan canvas.py btbreak_params — Standard/Sensitive × delay>=1000 / 500<=delay<1000.
 * Drop Standard 500ms is -0.17°C/sample (= 0.34°C/s), not Artisan's -0.20 (0.40°C/s),
 * so the same bend arms at both poll intervals.
 */
const MINIMUM: Record<BtBreakKind, Record<AutoDetectMode, Record<PollMs, number>>> = {
    charge: { standard: { 1000: -0.67, 500: -0.34 }, sensitive: { 1000: 0, 500: 0 } },
    drop: { standard: { 1000: -0.34, 500: -0.17 }, sensitive: { 1000: 0, 500: 0 } },
};
const OFFSET: Record<BtBreakKind, Record<AutoDetectMode, Record<PollMs, number>>> = {
    charge: { standard: { 1000: 0.5, 500: 0.2 }, sensitive: { 1000: 0.5, 500: 0.1 } },
    drop: { standard: { 1000: 0.2, 500: 0.1 }, sensitive: { 1000: 0.2, 500: 0.05 } },
};
const MIN_BT: Record<BtBreakKind, number> = { charge: 77, drop: 160 };
const RECOVERY_C = 0.5;
const CONFIRM_SPAN_S = 1;
const CONFIRM_FALL_C: Record<AutoDetectMode, number> = { standard: 2, sensitive: 1 };
/** A rapid confirmed step may have only one falling leg. */
const STEP_FALL_C = 8;

const checkStepHold = (points: RawTemperatureSample[]): RawTemperatureSample | null => {
    const last = points[points.length - 1];
    for (let i = points.length - 2; i >= 2; i--) {
        const before = points[i - 2];
        const onset = points[i - 1];
        const dip = points[i];
        const beforeRate = Math.abs((onset.bt - before.bt) / (onset.timestamp - before.timestamp));
        const stepRate = (onset.bt - dip.bt) / (dip.timestamp - onset.timestamp);
        if (
            onset.bt - dip.bt >= STEP_FALL_C &&
            stepRate > 2.5 * beforeRate &&
            last.timestamp - dip.timestamp >= CONFIRM_SPAN_S &&
            points.slice(i + 1).every((point) => point.bt <= dip.bt + RECOVERY_C)
        )
            return onset;
    }
    return null;
};

const createBtBreakDetector = (kind: BtBreakKind, mode: AutoDetectMode, pollIntervalMs: PollMs) => {
    const period = pollIntervalMs / 1000;
    const minimum = MINIMUM[kind][mode][pollIntervalMs];
    const offset = OFFSET[kind][mode][pollIntervalMs];
    // Drop reversal is 0.78°C/s at both polls. The comparison is per sample, so 500ms uses 0.39.
    const reversal = mode === 'sensitive' ? 20 : kind === 'drop' ? 0.78 * period : 0.78;
    const minBt = MIN_BT[kind];
    let history: RawTemperatureSample[] = [];
    let lastTimestamp: number | null = null;
    let filter = createBtFilter();
    let candidate: { onset: RawTemperatureSample; dipBt: number; armedAt: number } | null = null;
    let held: RawTemperatureSample | null = null;

    const reset = () => {
        history = [];
        lastTimestamp = null;
        filter = createBtFilter();
        candidate = null;
        held = null;
    };

    const check = (stride: 1 | 2): RawTemperatureSample | null => {
        if (history.length < 5 * stride + 1) return null;
        const start = history.length - 1 - 5 * stride;
        const p = Array.from({ length: 6 }, (_, i) => history[start + i * stride]);
        // Preserve Artisan's nominal-interval deltas; compensate real sampling jitter.
        const delta = (a: RawTemperatureSample, b: RawTemperatureSample) =>
            ((b.bt - a.bt) / (b.timestamp - a.timestamp)) * period * stride;
        const before = -(delta(p[0], p[1]) + delta(p[1], p[2])) / 2;
        const leg1 = delta(p[3], p[4]);
        const leg2 = delta(p[4], p[5]);
        const after = (leg1 + leg2) / 2;
        const limit = minimum * (stride === 2 ? 1.5 : 1);
        if (
            leg1 < limit &&
            leg2 < limit &&
            (Math.abs(after) > offset + 2.5 * Math.abs(before) ||
                (after < 0 && before < 0 && -before - after > reversal))
        )
            return p[3]; // tight: current index - 2; wide: current index - 4
        return null;
    };

    return {
        reset,
        push(sample: RawTemperatureSample | null): RawTemperatureSample | null {
            if (
                !sample ||
                !Number.isFinite(sample.timestamp) ||
                sample.timestamp < 0 ||
                !Number.isFinite(sample.receivedAtMs) ||
                sample.receivedAtMs <= 0 ||
                !Number.isFinite(sample.bt) ||
                sample.bt <= 0 ||
                sample.bt >= 400
            ) {
                reset();
                return null;
            }
            if (lastTimestamp !== null) {
                const dt = sample.timestamp - lastTimestamp;
                if (dt <= 0) return null; // duplicate or late response; reconnect clears state separately
                if (dt > 3 * period)
                    reset(); // no interpolation across an extended sampling gap
                else if (dt < period / 2) return null; // exclude burst samples
            }
            lastTimestamp = sample.timestamp;
            if (filter(sample.bt, sample.timestamp * 1000) === null) {
                held ??= sample;
                return null;
            }
            if (held) {
                const last = history[history.length - 1];
                const confirmedStep =
                    last != null && held.bt <= last.bt - STEP_FALL_C && sample.bt <= held.bt + RECOVERY_C;
                if (confirmedStep) {
                    history.push(held);
                    if (history.length > 11) history.shift();
                }
                held = null;
            }
            history.push(sample);
            if (history.length > 11) history.shift();
            if (candidate) {
                if (sample.bt > candidate.dipBt + RECOVERY_C) candidate = null;
                else if (
                    sample.timestamp - candidate.armedAt >= CONFIRM_SPAN_S &&
                    candidate.onset.bt - sample.bt >= CONFIRM_FALL_C[mode]
                ) {
                    const onset = candidate.onset;
                    candidate = null;
                    return onset;
                } else {
                    candidate.dipBt = Math.min(candidate.dipBt, sample.bt);
                    return null;
                }
            }
            const step = checkStepHold(history);
            if (step && step.bt > minBt) return step;
            const hit = check(1) ?? check(2);
            if (hit && hit.bt > minBt) {
                candidate = { onset: hit, dipBt: sample.bt, armedAt: sample.timestamp };
            }
            return null;
        },
    };
};

/** Confirm a slope break against recovery; report the original bend. */
export const createAutoChargeDetector = (mode: AutoChargeMode, pollIntervalMs: PollMs) =>
    createBtBreakDetector('charge', mode, pollIntervalMs);

/** Drop uses the same confirmation, including a held rapid step below 160°C. */
export const createAutoDropDetector = (mode: AutoDropMode, pollIntervalMs: PollMs) =>
    createBtBreakDetector('drop', mode, pollIntervalMs);
