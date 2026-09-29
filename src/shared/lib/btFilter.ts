/** 물리적으로 불가능한 BT 판정 범위 (°C). 커피 로스팅 BT 실측 상한 ~260, TC 단선 시 0/1372 등이 걸림 */
const BT_MIN_C = 0;
const BT_MAX_C = 400;
/** 실제 최대 변화율 (°C/s). 투입 직후 급락도 ~3–8°C/s — 15면 실측은 전부 통과, 글리치만 거부 */
const MAX_RATE_C_PER_S = 15;
const MIN_DT_S = 0.25;
/** 재연결 갭 등 긴 공백은 10s로 클램프 → 최대 150°C 점프 허용 */
const MAX_DT_S = 10;

const clampDt = (fromMs: number, toMs: number) => Math.min(Math.max((toMs - fromMs) / 1000, MIN_DT_S), MAX_DT_S);

/**
 * BT 이상치 필터 (스파이크·0값·단선 거부).
 * - 범위 밖(≤0, ≥400) 즉시 거부
 * - 변화율 초과 샘플은 1회 보류 — 다음 샘플이 보류값과 연속이면 실제 스텝으로 소급 승인
 *   (단일 스파이크는 다음 샘플이 원래 궤적으로 복귀하므로 자연 폐기)
 */
export const createBtFilter = () => {
    let last: { bt: number; tMs: number } | null = null;
    let rejected: { bt: number; tMs: number } | null = null;

    return (bt: number, tMs: number): number | null => {
        if (!Number.isFinite(bt) || bt <= BT_MIN_C || bt >= BT_MAX_C) return null;
        if (last === null) {
            last = { bt, tMs };
            return bt;
        }
        if (Math.abs(bt - last.bt) <= MAX_RATE_C_PER_S * clampDt(last.tMs, tMs)) {
            last = { bt, tMs };
            rejected = null;
            return bt;
        }
        // 직전 거부 샘플과 연속이면 실제 급변(프로브 교체·도어 개방 등)으로 승인
        if (rejected !== null && Math.abs(bt - rejected.bt) <= MAX_RATE_C_PER_S * clampDt(rejected.tMs, tMs)) {
            last = { bt, tMs };
            rejected = null;
            return bt;
        }
        rejected = { bt, tMs };
        return null;
    };
};
