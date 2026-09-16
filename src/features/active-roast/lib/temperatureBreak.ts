export type TemperatureSample = { t: number; bt: number };

/**
 * Detect a falling-rate break, not accumulated cooling. Compare two legs before
 * and after the bend, as in Artisan's checkTop. Rates use sensor time (°C/s),
 * so the same calibration works at 500/1000ms and with polling jitter.
 * Standard reference: artisanlib/canvas.py btbreak_params, main.py checkTop.
 */
export const detectTemperatureBreak = (samples: TemperatureSample[], minRate: number): TemperatureSample | null => {
    // The wider pass handles quantized sensors (e.g. alternating 0/1°C steps).
    for (const stride of [1, 2]) {
        const end = samples.length - 1;
        if (end < 5 * stride) continue;
        const p0 = samples[end - 5 * stride];
        const p2 = samples[end - 3 * stride];
        const p3 = samples[end - 2 * stride];
        const p4 = samples[end - stride];
        const p5 = samples[end];
        const before = (p2.bt - p0.bt) / (p2.t - p0.t);
        const after1 = (p4.bt - p3.bt) / (p4.t - p3.t);
        const after2 = (p5.bt - p4.bt) / (p5.t - p4.t);
        const after = (p5.bt - p3.bt) / (p5.t - p3.t);
        if (
            after1 < -minRate &&
            after2 < -minRate &&
            (-after > 0.5 + 2.5 * Math.abs(before) || (before > 0 && before - after > 0.78))
        ) {
            // On a flat top, use the last point before the confirmed falling legs.
            return p3.bt >= p2.bt ? p3 : p2;
        }
    }
    return null;
};
