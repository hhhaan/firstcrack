import { createBtFilter } from './btFilter';

export type AutoChargeMode = 'standard' | 'sensitive';
export type RawTemperatureSample = {
    timestamp: number; // sidecar monotonic seconds; never Unix time
    receivedAtMs: number; // frontend Date.now(), captured on response
    bt: number;
};

export const createAutoChargeDetector = (mode: AutoChargeMode, pollIntervalMs: 500 | 1000) => {
    const period = pollIntervalMs / 1000;
    const fast = pollIntervalMs === 500;
    const sensitive = mode === 'sensitive';
    const minimum = sensitive ? 0 : fast ? -0.34 : -0.67;
    const offset = fast ? (sensitive ? 0.1 : 0.2) : 0.5;
    const reversal = sensitive ? 20 : 0.78;
    let history: RawTemperatureSample[] = [];
    let lastTimestamp: number | null = null;
    let filter = createBtFilter();

    const reset = () => {
        history = [];
        lastTimestamp = null;
        filter = createBtFilter();
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
                history = []; // preserve the existing filter's two-reading step recovery
                return null;
            }
            history.push(sample);
            if (history.length > 11) history.shift();
            if (sample.bt <= 77) return null;
            return check(1) ?? check(2);
        },
    };
};
