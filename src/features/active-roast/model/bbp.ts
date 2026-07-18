import { TSV_HEADER } from '@features/active-roast/lib/tsv-writer';
import { create } from 'zustand';

/** charge가 이 시간(초)보다 늦으면 드럼 열 상태가 리셋된 것으로 보고 BBP를 폐기한다. */
export const BBP_MAX_SECONDS = 1800;

export interface BbpSample {
    bt: number;
    et: number | null;
    heater: number;
    fan: number;
    drum: number;
}

interface BbpPoint extends BbpSample {
    /** BBP 시작(이전 드롭) 기준 상대 초 */
    t: number;
}

export interface BbpSummary {
    seconds: number;
    chargeTemp: number;
}

export type BbpResult = BbpSummary & { tsv: string };

interface BbpState {
    active: boolean;
    /** 이전 드롭 wall-clock (ms). 0 = 미기록 */
    startMs: number;
    points: BbpPoint[];
    /** charge 시 확정된 요약 — useSaveRoast가 소비. 다음 begin()에서 클리어 */
    finalized: BbpSummary | null;

    begin: (startMs: number) => void;
    append: (sample: BbpSample, nowMs: number) => void;
    finalize: (chargeMs: number) => BbpResult | null;
}

const toTsv = (points: BbpPoint[]): string =>
    TSV_HEADER +
    points.map((p) => `${p.t.toFixed(1)}\t${p.bt}\t${p.et ?? ''}\t\t${p.heater}\t${p.fan}\t${p.drum}\n`).join('');

export const useBbpStore = create<BbpState>((set, get) => ({
    active: false,
    startMs: 0,
    points: [],
    finalized: null,

    begin: (startMs) => set({ active: true, startMs, points: [], finalized: null }),

    append: (sample, nowMs) => {
        const { active, startMs, points } = get();
        if (!active) return;
        const t = (nowMs - startMs) / 1000;
        if (t < 0 || t > BBP_MAX_SECONDS) return;
        if (points.length > 0 && t - points[points.length - 1].t < 1) return;
        set({ points: [...points, { t, ...sample }] });
    },

    finalize: (chargeMs) => {
        const { active, startMs, points } = get();
        const seconds = Math.round((chargeMs - startMs) / 1000);
        const valid = active && points.length >= 2 && seconds > 0 && seconds <= BBP_MAX_SECONDS;
        if (!valid) {
            set({ active: false, startMs: 0, points: [], finalized: null });
            return null;
        }
        const chargeTemp = points[points.length - 1].bt;
        const result: BbpResult = { seconds, chargeTemp, tsv: toTsv(points) };
        set({ active: false, startMs: 0, points: [], finalized: { seconds, chargeTemp } });
        return result;
    },
}));
