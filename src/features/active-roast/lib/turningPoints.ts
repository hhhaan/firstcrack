export interface TurningPoint {
    timeSec: number;
    temp: number;
    /** true = TP 타임아웃 폴백으로 강제 확정 (실제 골짜기 감지 아님) */
    fallback?: boolean;
}

// Artisan 방식 TP 감지: raw BT 단조 상승 트리거 + charge~현재 전역 최솟값 재스캔.
// 미분·스무딩 없음 — 노이즈는 대개 단조성을 깨서 발화를 늦출 뿐(무해).
// 하강 중 3초 연속 노이즈 상승 플래토면 조기 발화 가능하나, 전역 최솟값 재스캔이
// 그 시점까지의 최저점을 잡으므로 오차는 진행 중 하강폭 이내로 제한된다.
// 트리거가 늦어도 전역 최솟값 재스캔이 TP 시각/온도를 정확히 복원한다.
const TP_MIN_ELAPSED_S = 20; // charge 후 floor (Artisan checkTPalarmtime 동일)
const TP_MONO_SPAN_S = 3; // 단조 비감소 확인 구간 — 시간 기준이라 pollIntervalMs 독립
const TP_TEMP_MIN_C = 50; // Artisan sanity range: 실기 TP 골짜기는 50~150°C
const TP_TEMP_MAX_C = 150;

export const detectTurningPoints = (xs: number[], bt: number[]): TurningPoint[] => {
    const last = xs.length - 1;
    if (last < 1 || xs[last] < TP_MIN_ELAPSED_S) return [];

    // 트리거: 최근 TP_MONO_SPAN_S초 구간의 raw BT가 단조 비감소 + 확실한 순상승
    let start = last;
    while (start > 0 && xs[last] - xs[start] < TP_MONO_SPAN_S) start--;
    if (xs[last] - xs[start] < TP_MONO_SPAN_S) return [];
    for (let i = start + 1; i <= last; i++) {
        if (bt[i] < bt[i - 1]) return [];
    }
    if (bt[start] >= bt[last]) return [];

    // 값 계산: charge(t=0)~현재 raw BT 전역 최솟값이 TP
    let minTemp = Infinity;
    let minTimeSec = xs[last];
    for (let i = 0; i <= last; i++) {
        if (xs[i] < 0) continue; // pre-charge 구간은 TP 대상 아님
        if (bt[i] < minTemp) {
            minTemp = bt[i];
            minTimeSec = xs[i];
        }
    }
    if (minTemp <= TP_TEMP_MIN_C || minTemp >= TP_TEMP_MAX_C) return [];
    return [{ timeSec: minTimeSec, temp: minTemp }];
};
