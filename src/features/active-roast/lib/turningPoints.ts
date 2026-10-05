export interface TurningPoint {
    timeSec: number;
    temp: number;
    /** true = TP 타임아웃 폴백으로 강제 확정 (실제 골짜기 감지 아님) */
    fallback?: boolean;
}

// Artisan checkTPalarmtime compares later readings with the window's first reading.
// Allow small raw noise, but require a measurable rebound from a supported valley.
const TP_MIN_ELAPSED_S = 20; // charge 후 floor (Artisan checkTPalarmtime 동일)
const TP_RISE_SPAN_S = 3;
const TP_SLOW_RISE_SPAN_S = 6;
const TP_NOISE_C = 0.3;
const TP_REBOUND_C = 0.5;
const TP_ISOLATED_DIP_C = 1;
const TP_TEMP_MIN_C = 50; // Artisan sanity range: 실기 TP 골짜기는 50~150°C
const TP_TEMP_MAX_C = 150;

export const detectTurningPoints = (xs: number[], bt: number[], maxGapSec = 1.5): TurningPoint[] => {
    const last = xs.length - 1;
    if (
        last < 1 ||
        bt.length !== xs.length ||
        !Number.isFinite(xs[last]) ||
        !Number.isFinite(bt[last]) ||
        xs[last] < TP_MIN_ELAPSED_S
    )
        return [];

    // 값 계산: charge(t=0)~현재 raw BT 전역 최솟값이 TP
    let minTemp = Infinity;
    let minTimeSec = xs[last];
    for (let i = 0; i <= last; i++) {
        if (!Number.isFinite(xs[i]) || xs[i] < 0) continue; // pre-charge 구간은 TP 대상 아님
        // ponytail: ignore unsupported >1°C one-reading dips; tune against actual probe recordings.
        if (
            i > 0 &&
            i < last &&
            xs[i] - xs[i - 1] <= maxGapSec &&
            xs[i + 1] - xs[i] <= maxGapSec &&
            bt[i] < Math.min(bt[i - 1], bt[i + 1]) - TP_ISOLATED_DIP_C
        )
            continue;
        if (bt[i] < minTemp) {
            minTemp = bt[i];
            minTimeSec = xs[i];
        }
    }
    if (minTemp <= TP_TEMP_MIN_C || minTemp >= TP_TEMP_MAX_C) return [];
    // Gentle valleys can confirm by a longer rise instead of waiting for a fixed °C gain.
    const span = bt[last] - minTemp >= TP_REBOUND_C ? TP_RISE_SPAN_S : TP_SLOW_RISE_SPAN_S;
    let start = last;
    while (start > 0 && xs[last] - xs[start] < span) {
        const dt = xs[start] - xs[start - 1];
        if (!Number.isFinite(dt) || dt <= 0 || dt > maxGapSec || !Number.isFinite(bt[start - 1])) return [];
        start--;
    }
    if (xs[last] - xs[start] < span || bt[start] >= bt[last]) return [];
    for (let i = start + 1; i <= last; i++) {
        if (bt[i] < bt[start] - TP_NOISE_C) return [];
    }
    return [{ timeSec: minTimeSec, temp: minTemp }];
};
