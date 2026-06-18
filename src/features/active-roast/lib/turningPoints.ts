export interface TurningPoint {
    timeSec: number;
    temp: number;
}

const SMOOTH_WINDOW = 7;
const MIN_VALID_POINTS = 15;
const TP_LOOKBACK_SEC = 30;

const movingAvg = (data: number[], w: number): number[] => {
    const half = Math.floor(w / 2);
    return data.map((_, i) => {
        let sum = 0,
            count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
            sum += data[j];
            count++;
        }
        return count > 0 ? sum / count : 0;
    });
};

const centralDiff = (xs: number[], ys: number[]): number[] =>
    ys.map((_, i) => {
        if (i === 0) return (ys[1] - ys[0]) / Math.max(1e-9, xs[1] - xs[0]);
        if (i === ys.length - 1) return (ys[i] - ys[i - 1]) / Math.max(1e-9, xs[i] - xs[i - 1]);
        return (ys[i + 1] - ys[i - 1]) / Math.max(1e-9, xs[i + 1] - xs[i - 1]);
    });

export const detectTurningPoints = (xs: number[], bt: number[]): TurningPoint[] => {
    if (xs.length < MIN_VALID_POINTS) return [];

    // Double smooth to suppress noise before differentiating
    const smoothed = movingAvg(movingAvg(bt, SMOOTH_WINDOW), SMOOTH_WINDOW);
    const d1 = centralDiff(xs, smoothed);

    const points: TurningPoint[] = [];

    for (let i = 2; i < xs.length - 2; i++) {
        // TP: 1st derivative neg → pos  (BT local minimum)
        if (d1[i - 1] < -0.01 && d1[i + 1] > 0.01) {
            // 스무딩 lag 보정: 탐지 시점 직전 LOOKBACK_SEC 구간에서 실제 최솟값 역추적
            const lookbackStart = xs[i] - TP_LOOKBACK_SEC;
            let minTemp = Infinity;
            let minTimeSec = xs[i];
            for (let j = i; j >= 0 && xs[j] >= lookbackStart; j--) {
                if (bt[j] < minTemp) {
                    minTemp = bt[j];
                    minTimeSec = xs[j];
                }
            }
            points.push({ timeSec: minTimeSec, temp: minTemp });
            break; // TP는 로스팅당 한 번만
        }
    }

    return points;
};
