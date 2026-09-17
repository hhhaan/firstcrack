import { TSV_HEADER } from '@shared/lib/tsv-writer';
import { create } from 'zustand';

/** charge가 이 시간(초)보다 늦으면 드럼 열 상태가 리셋된 것으로 보고 BBP를 폐기한다. */
export const BBP_MAX_SECONDS = 1800;
/** 대기 중 차트 창 (#433). 기록 캡과 별개. */
export const BBP_DISPLAY_SECONDS = 900;

export interface BbpSample {
    bt: number;
    et: number | null;
    heater: number | null;
    fan: number;
    drum: number;
}

export interface BbpPoint extends BbpSample {
    /** BBP 시작(End 확정) 기준 상대 초 */
    t: number;
}

export interface BbpSummary {
    seconds: number;
    chargeTemp: number;
}

export interface FinalizedBbp extends BbpSummary {
    /** 이 요약이 귀속되는 로스트 세션 — 저장 시 대조해 다른 세션 오염을 막는다 */
    sessionId: string;
}

export type BbpResult = BbpSummary & { tsv: string };

interface BbpState {
    active: boolean;
    /** 이전 드롭 wall-clock (ms). 0 = 미기록 */
    startMs: number;
    points: BbpPoint[];
    /**
     * charge 시 확정된 요약 — useSaveRoast가 소비.
     * 드롭(begin) → 요약 모달 → 저장 순서라 begin()이 지우면 안 된다.
     * 다음 finalize()가 교체하고, sessionId 대조로 오염을 막는다.
     */
    finalized: FinalizedBbp | null;
    /** Session-scoped display samples; never persisted as live session state. */
    finalizedPoints: BbpPoint[];

    begin: (startMs: number) => void;
    append: (sample: BbpSample, nowMs: number) => void;
    finalize: (chargeMs: number, sessionId: string) => BbpResult | null;
}

const toTsv = (points: BbpPoint[]): string =>
    TSV_HEADER +
    // 8열(heater_set)은 비워 둔다 — pre-charge 샘플에는 세트포인트가 없다
    points
        .map((p) => `${p.t.toFixed(1)}\t${p.bt}\t${p.et ?? ''}\t\t${p.heater ?? ''}\t${p.fan}\t${p.drum}\t\n`)
        .join('');

export const useBbpStore = create<BbpState>((set, get) => ({
    active: false,
    startMs: 0,
    points: [],
    finalized: null,
    finalizedPoints: [],

    // finalized는 건드리지 않는다 — 직전 세션이 아직 저장 전일 수 있다
    begin: (startMs) => set({ active: true, startMs, points: [] }),

    append: (sample, nowMs) => {
        const { active, startMs, points } = get();
        if (!active) return;
        const t = (nowMs - startMs) / 1000;
        if (t < 0 || t > BBP_MAX_SECONDS) return;
        if (points.length > 0 && t - points[points.length - 1].t < 1) return;
        set({ points: [...points, { t, ...sample }] });
    },

    finalize: (chargeMs, sessionId) => {
        const { active, startMs, points: all } = get();
        const cutoff = (chargeMs - startMs) / 1000;
        // auto-charge는 lookback으로 잡은 onset을 charge 시각으로 쓰므로 그 이후 폴링된
        // 투입 직후(BT 급락) 샘플이 섞인다 — 잘라내야 chargeTemp가 실제 투입 온도가 된다.
        const points = all.filter((p) => p.t <= cutoff);
        const seconds = Math.round(cutoff);
        const valid = active && points.length >= 2 && seconds > 0 && seconds <= BBP_MAX_SECONDS;
        if (!valid) {
            set({ active: false, startMs: 0, points: [], finalized: null, finalizedPoints: [] });
            return null;
        }
        const chargeTemp = points[points.length - 1].bt;
        const result: BbpResult = { seconds, chargeTemp, tsv: toTsv(points) };
        set({
            active: false,
            startMs: 0,
            points: [],
            finalized: { sessionId, seconds, chargeTemp },
            finalizedPoints: points,
        });
        return result;
    },
}));
