import { TSV_HEADER } from '@shared/lib/tsv-writer';
import { create } from 'zustand';

/** Rolling FIFO window (seconds) kept immediately before Charge. */
export const BBP_MAX_SECONDS = 1200;

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

const windowOrigin = (endT: number, windowSeconds = BBP_MAX_SECONDS) => Math.max(0, endT - windowSeconds);

/** Drop samples older than the last BBP_MAX_SECONDS before `endT`. Times stay End-relative. */
const clipBbpWindow = (points: BbpPoint[], endT: number, windowSeconds = BBP_MAX_SECONDS): BbpPoint[] => {
    const origin = windowOrigin(endT, windowSeconds);
    return points.filter((p) => p.t >= origin && p.t <= endT);
};

/** Charge-relative copy of the kept window so stored/display t starts near 0. */
export const rebaseBbpWindow = (points: BbpPoint[], endT: number, windowSeconds = BBP_MAX_SECONDS): BbpPoint[] => {
    const origin = windowOrigin(endT, windowSeconds);
    const kept = clipBbpWindow(points, endT, windowSeconds);
    return origin === 0 ? kept : kept.map((p) => ({ ...p, t: p.t - origin }));
};

interface BbpState {
    active: boolean;
    /** First-batch preheat is chart-only; End→Charge is recorded and saved. */
    recording: boolean;
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

    begin: (startMs: number, seed?: BbpPoint[], recording?: boolean) => void;
    append: (sample: BbpSample, nowMs: number) => void;
    /** Drop cancel: clear in-progress samples, keep the previous session's finalized BBP. */
    abort: () => void;
    finalize: (chargeMs: number, sessionId: string) => BbpResult | null;
}

/** Local TSV id for the in-progress A→B wait. Charge rewrites under the new sessionId. */
export const BBP_INPROGRESS_ID = 'inprogress';
const BBP_LIVE_KEY = 'fc_bbp_live';

const persistLive = (active: boolean, startMs: number, points: BbpPoint[]) => {
    try {
        if (typeof localStorage === 'undefined') return;
        if (!active) {
            localStorage.removeItem(BBP_LIVE_KEY);
            return;
        }
        localStorage.setItem(BBP_LIVE_KEY, JSON.stringify({ startMs, points }));
    } catch {
        // ponytail: quota/private-mode — in-memory BBP still runs this session
    }
};

export const readLiveBbp = (): { startMs: number; points: BbpPoint[] } | null => {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(BBP_LIVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { startMs?: unknown; points?: unknown };
        if (typeof parsed.startMs !== 'number' || parsed.startMs <= 0 || !Array.isArray(parsed.points)) return null;
        return { startMs: parsed.startMs, points: parsed.points as BbpPoint[] };
    } catch {
        return null;
    }
};

export const bbpPointsToTsv = (points: BbpPoint[]): string =>
    TSV_HEADER +
    points
        .map((p) => `${p.t.toFixed(1)}\t${p.bt}\t${p.et ?? ''}\t\t${p.heater ?? ''}\t${p.fan}\t${p.drum}\t\n`)
        .join('');

const toTsv = bbpPointsToTsv;

export const useBbpStore = create<BbpState>((set, get) => ({
    active: false,
    recording: false,
    startMs: 0,
    points: [],
    finalized: null,
    finalizedPoints: [],

    // finalized는 건드리지 않는다 — 직전 세션이 아직 저장 전일 수 있다
    begin: (startMs, seed = [], recording = true) => {
        const points = seed.length > 0 ? clipBbpWindow(seed, seed[seed.length - 1]?.t ?? 0) : [];
        persistLive(recording, startMs, points);
        set({ active: true, recording, startMs, points });
    },

    append: (sample, nowMs) => {
        const { active, recording, startMs, points } = get();
        if (!active) return;
        const t = (nowMs - startMs) / 1000;
        if (t < 0) return;
        if (points.length > 0 && t - points[points.length - 1].t < 1) return;
        const next = clipBbpWindow([...points, { t, ...sample }], t);
        if (recording) persistLive(true, startMs, next);
        set({ points: next });
    },

    abort: () => {
        persistLive(false, 0, []);
        set({ active: false, recording: false, startMs: 0, points: [] });
    },

    finalize: (chargeMs, sessionId) => {
        const { active, recording, startMs, points: all } = get();
        if (!recording) {
            get().abort();
            return null;
        }
        const cutoff = (chargeMs - startMs) / 1000;
        // auto-charge는 lookback으로 잡은 onset을 charge 시각으로 쓰므로 그 이후 폴링된
        // 투입 직후(BT 급락) 샘플이 섞인다 — 잘라내야 chargeTemp가 실제 투입 온도가 된다.
        const points = rebaseBbpWindow(all, cutoff);
        const seconds = Math.round(Math.min(Math.max(cutoff, 0), BBP_MAX_SECONDS));
        const valid = active && points.length >= 2 && seconds > 0;
        if (!valid) {
            persistLive(false, 0, []);
            set({ active: false, recording: false, startMs: 0, points: [], finalized: null, finalizedPoints: [] });
            return null;
        }
        const chargeTemp = points[points.length - 1].bt;
        const result: BbpResult = { seconds, chargeTemp, tsv: toTsv(points) };
        persistLive(false, 0, []);
        set({
            active: false,
            recording: false,
            startMs: 0,
            points: [],
            finalized: { sessionId, seconds, chargeTemp },
            finalizedPoints: points,
        });
        return result;
    },
}));

export const hydrateLiveBbp = (): boolean => {
    const live = readLiveBbp();
    if (!live) return false;
    const endT = live.points[live.points.length - 1]?.t ?? 0;
    useBbpStore.setState({
        active: true,
        recording: true,
        startMs: live.startMs,
        points: clipBbpWindow(live.points, endT),
    });
    return true;
};
