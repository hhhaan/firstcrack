/** Quest Bean VOC 등 % 채널 — 탭/±/키보드 모두 이 간격으로 스냅 (#436) */
export const PERCENT_SNAP = 5;

export const isPercentUnit = (unit?: string): boolean => unit == null || unit === '%' || unit === '';

export const snapPercent = (value: number, min = 0, max = 100, step = PERCENT_SNAP): number => {
    const snapped = Math.round(value / step) * step;
    return Math.min(max, Math.max(min, snapped));
};

export const stepPercent = (value: number, delta: number, min = 0, max = 100, step = PERCENT_SNAP): number =>
    snapPercent(value + delta, min, max, step);

export const percentTicks = (min: number, max: number, step = PERCENT_SNAP): number[] => {
    const ticks: number[] = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
    if (ticks[0] !== min) ticks.unshift(min);
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
    return ticks;
};

/** 지시가 남아 있고 실측이 수렴 오차를 넘을 때만 라이브 라인·기기 n */
export const showLiveFollow = (desired: number | undefined, feedback: number | null, tolerance: number): boolean =>
    desired != null && feedback != null && Math.abs(desired - feedback) > tolerance;
