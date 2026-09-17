/**
 * heater write_map.max에서 수렴·이탈 허용치를 같이 유도한다 (#428).
 * 이탈은 수렴보다 작을 수 없다 — 수렴으로 통과한 잔차를 바로 외부 개입으로 뒤집지 않는다.
 */

const DEFAULT_HEATER_MAX = 100;
const CONVERGE_RATIO = 0.01;
const DIVERGE_RATIO = 0.02;
/** 정수 스텝 한 칸은 추종으로 본다. 이보다 낮추면 잔차 1이 미반영으로 남거나 바로 이탈이 된다. */
const STEP_FLOOR = 1;

export function heaterScale(heaterMax?: number | null): number {
    return heaterMax != null && Number.isFinite(heaterMax) && heaterMax > 0 ? heaterMax : DEFAULT_HEATER_MAX;
}

/** 지시 대비 이만큼이면 기기가 따라온 것으로 본다. 0~100 → 1, 0~10 → 1. */
export function convergeTolerance(heaterMax?: number | null): number {
    return Math.max(STEP_FLOOR, heaterScale(heaterMax) * CONVERGE_RATIO);
}

/** 마지막 확정 명령에서 실측이 이만큼 **초과**면 외부 개입 후보. 0~100 → 2, 0~10 → 1. */
export function divergeTolerance(heaterMax?: number | null): number {
    const max = heaterScale(heaterMax);
    return Math.max(convergeTolerance(max), max * DIVERGE_RATIO);
}
