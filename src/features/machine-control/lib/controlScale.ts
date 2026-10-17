/** Heater feedback tolerance for display settling and Drop-zero retries. */

const DEFAULT_HEATER_MAX = 100;
const CONVERGE_RATIO = 0.01;
/** 정수 스텝 한 칸은 추종으로 본다. 잔차 1 때문에 화면의 지시값이 남지 않도록 한다. */
const STEP_FLOOR = 1;

export function heaterScale(heaterMax?: number | null): number {
    return heaterMax != null && Number.isFinite(heaterMax) && heaterMax > 0 ? heaterMax : DEFAULT_HEATER_MAX;
}

/** 지시 대비 이만큼이면 기기가 따라온 것으로 본다. 0~100 → 1, 0~10 → 1. */
export function convergeTolerance(heaterMax?: number | null): number {
    return Math.max(STEP_FLOOR, heaterScale(heaterMax) * CONVERGE_RATIO);
}
