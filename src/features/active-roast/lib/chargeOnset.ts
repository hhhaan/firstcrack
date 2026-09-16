export interface ChargeSample {
    /** 단조 증가 시간(초). abs·session 상대 모두 가능 */
    timeSec: number;
    bt: number;
}

export interface ChargeOnset {
    timeSec: number;
    bt: number;
}

const DEFAULT_LOOKBACK_SEC = 20;
/** peak 후보: 확인 BT 대비 최소 낙차 (°C) — 낙차 중 노이즈 local-max 배제 */
const DEFAULT_MIN_DROP_C = 2;
const PEAK_NEAR_C = 0.5;

/**
 * BT 낙차 확인 후 시작점 후처리 (Charge / Drop 공용).
 * lookback에서 확인점보다 충분히 높은 rightmost local max = plateau 끝.
 * (낙차 구간 노이즈 peak는 minDrop 바닥으로 제외)
 */
export const detectChargeOnset = (
    history: readonly ChargeSample[],
    opts?: { lookbackSec?: number; minDropC?: number },
): ChargeOnset | null => {
    if (history.length === 0) return null;
    const last = history[history.length - 1];
    if (history.length === 1) return { timeSec: last.timeSec, bt: last.bt };

    const lookbackSec = opts?.lookbackSec ?? DEFAULT_LOOKBACK_SEC;
    const minDropC = opts?.minDropC ?? DEFAULT_MIN_DROP_C;
    const cutoff = last.timeSec - lookbackSec;
    const floor = last.bt + minDropC;

    const window: ChargeSample[] = [];
    for (let i = 0; i < history.length; i++) {
        if (history[i].timeSec >= cutoff) window.push(history[i]);
    }
    if (window.length === 0) return { timeSec: last.timeSec, bt: last.bt };
    if (window.length === 1) return { timeSec: window[0].timeSec, bt: window[0].bt };

    // rightmost local max above floor (plateau end before drop)
    let found = false;
    let onset: ChargeOnset = { timeSec: window[0].timeSec, bt: window[0].bt };
    for (let i = 1; i < window.length - 1; i++) {
        const prev = window[i - 1].bt;
        const cur = window[i].bt;
        const next = window[i + 1].bt;
        if (cur < floor) continue;
        if (cur >= prev && cur >= next) {
            onset = { timeSec: window[i].timeSec, bt: cur };
            found = true;
        }
    }

    // endpoint: first sample can be the peak of a pure descent
    if (window[0].bt >= floor && window[0].bt >= window[1].bt) {
        if (!found || window[0].timeSec >= onset.timeSec) {
            // only prefer endpoint if no later peak, or it's itself a leading peak
            if (!found) {
                onset = { timeSec: window[0].timeSec, bt: window[0].bt };
                found = true;
            }
        }
    }

    if (found) return onset;

    // fallback: rightmost near-max of global max in lookback
    let maxBt = -Infinity;
    for (const p of window) {
        if (p.bt > maxBt) maxBt = p.bt;
    }
    if (!Number.isFinite(maxBt)) return { timeSec: last.timeSec, bt: last.bt };

    let fb: ChargeOnset = { timeSec: last.timeSec, bt: last.bt };
    for (const p of window) {
        if (p.bt >= maxBt - PEAK_NEAR_C) {
            fb = { timeSec: p.timeSec, bt: p.bt };
        }
    }
    return fb;
};
