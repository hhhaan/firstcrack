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

/** Artisan canvas.py btbreak_params — Standard/Sensitive × delay>=1000 / 500<=delay<1000 */
const MINIMUM: Record<BtBreakKind, Record<AutoDetectMode, Record<PollMs, number>>> = {
    charge: { standard: { 1000: -0.67, 500: -0.34 }, sensitive: { 1000: 0, 500: 0 } },
    drop: { standard: { 1000: -0.34, 500: -0.2 }, sensitive: { 1000: 0, 500: 0 } },
};
const OFFSET: Record<BtBreakKind, Record<AutoDetectMode, Record<PollMs, number>>> = {
    charge: { standard: { 1000: 0.5, 500: 0.2 }, sensitive: { 1000: 0.5, 500: 0.1 } },
    drop: { standard: { 1000: 0.2, 500: 0.1 }, sensitive: { 1000: 0.2, 500: 0.05 } },
};
const MIN_BT: Record<BtBreakKind, number> = { charge: 77, drop: 160 };
/** Standard Drop default: fall this far below the bend. 0 confirms on the next sample that does not recover. */
const DROP_CONFIRM_C = 2;
const DROP_RECOVERY_C = 0.5;
/** Single-sample dump that then holds — BTbreak needs two falling legs and misses this. */
const DROP_STEP_C = 8;

const checkStepHold = (points: RawTemperatureSample[], confirmC: number): RawTemperatureSample | null => {
    if (points.length < 4) return null;
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    let plateau = points[0];
    for (let i = 1; i < points.length - 2; i++) {
        if (points[i].bt >= plateau.bt) plateau = points[i];
    }
    const need = Math.max(DROP_STEP_C, confirmC);
    if (plateau.bt - a.bt < need || plateau.bt - b.bt < need) return null;
    return plateau;
};

const createBtBreakDetector = (kind: BtBreakKind, mode: AutoDetectMode, pollIntervalMs: PollMs, confirmC: number) => {
    const period = pollIntervalMs / 1000;
    const minimum = MINIMUM[kind][mode][pollIntervalMs];
    const offset = OFFSET[kind][mode][pollIntervalMs];
    const reversal = mode === 'sensitive' ? 20 : 0.78;
    const minBt = MIN_BT[kind];
    let history: RawTemperatureSample[] = [];
    let lastTimestamp: number | null = null;
    let filter = createBtFilter();
    let candidate: { onset: RawTemperatureSample; dipBt: number } | null = null;
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
            (Math.abs(after) > Math.min(6.4, offset + 2.5 * Math.abs(before)) ||
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
                if (kind === 'drop') held = sample;
                else history = []; // Charge: two-reading step recovery starts a new window
                return null;
            }
            if (kind === 'drop' && held) {
                const last = history[history.length - 1];
                const confirmedStep =
                    last != null && held.bt <= last.bt - DROP_STEP_C && Math.abs(sample.bt - held.bt) <= 2;
                if (confirmedStep) {
                    history.push(held);
                    if (history.length > 11) history.shift();
                }
                held = null;
            }
            history.push(sample);
            if (history.length > 11) history.shift();
            if (sample.bt <= minBt) {
                candidate = null;
                return null;
            }
            if (candidate) {
                const fall = candidate.onset.bt - sample.bt;
                if (sample.bt > candidate.dipBt + DROP_RECOVERY_C) candidate = null;
                else if (confirmC <= 0 || fall >= confirmC) {
                    const onset = candidate.onset;
                    candidate = null;
                    return onset;
                } else if (sample.bt < candidate.dipBt) {
                    candidate = { onset: candidate.onset, dipBt: sample.bt };
                    return null;
                } else candidate = null;
            }
            const hit = check(1) ?? check(2);
            if (hit) {
                if (kind === 'drop' || confirmC > 0) {
                    candidate = { onset: hit, dipBt: sample.bt };
                    return null;
                }
                return hit;
            }
            return kind === 'drop' ? checkStepHold(history, confirmC) : null;
        },
    };
};

/** °C below the bend before the mark. Charge default 0 fires on the slope break. */
export const createAutoChargeDetector = (mode: AutoChargeMode, pollIntervalMs: PollMs, confirmC = 0) =>
    createBtBreakDetector('charge', mode, pollIntervalMs, confirmC);

/** Omitted confirm keeps Standard at 2°C and Sensitive at the next non-recovering sample. */
export const createAutoDropDetector = (
    mode: AutoDropMode,
    pollIntervalMs: PollMs,
    confirmC = mode === 'sensitive' ? 0 : DROP_CONFIRM_C,
) => createBtBreakDetector('drop', mode, pollIntervalMs, confirmC);
