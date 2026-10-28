import type { BbpPoint, BbpResult, BbpSample, FinalizedBbp } from '../lib/bbp-types';

export { bbpPointsToTsv } from '../lib/bbp-archive';

import { isBbpAllowedEvent } from '@features/active-roast/lib/bbp-events';
import type { LogEntry } from '@shared/types/roast';
import { create } from 'zustand';
import { type BbpCapture, captureBatchBbp, splitBatchBbp } from '../lib/batch-timeline';

/** Rolling FIFO window (seconds) kept immediately before Charge. */
export const BBP_MAX_SECONDS = 900;

export type { BbpPoint, BbpResult, BbpSample, BbpSummary, FinalizedBbp } from '../lib/bbp-types';

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
    /** Whether the live wait survives reload; every captured preheat is saved with its roast. */
    recording: boolean;
    /** 이전 드롭 wall-clock (ms). 0 = 미기록 */
    startMs: number;
    points: BbpPoint[];
    /** End-relative notes/heat/control writes for the live wait. */
    events: LogEntry[];
    /**
     * charge 시 확정된 요약 — useSaveRoast가 소비.
     * 드롭(begin) → 요약 모달 → 저장 순서라 begin()이 지우면 안 된다.
     * 다음 finalize()가 교체하고, sessionId 대조로 오염을 막는다.
     */
    finalized: FinalizedBbp | null;
    /** Session-scoped display samples; never persisted as live session state. */
    finalizedPoints: BbpPoint[];
    finalizedCapture: BbpCapture | null;

    /** Id of this tab's in-progress wait. Empty when nothing is being recorded. */
    liveGeneration: string;
    begin: (startMs: number, seed?: BbpPoint[], recording?: boolean) => void;
    append: (sample: BbpSample, nowMs: number) => void;
    setEvents: (action: LogEntry[] | ((prev: LogEntry[]) => LogEntry[])) => void;
    /** Drop cancel: clear in-progress samples, keep the previous session's finalized BBP. */
    abort: () => void;
    finalize: (chargeMs: number, sessionId: string) => BbpResult | null;
}

/** Local TSV id for the in-progress A→B wait. Charge rewrites under the new sessionId. */
export const BBP_INPROGRESS_ID = 'inprogress';
const BBP_LIVE_KEY = 'fc_bbp_live';
/**
 * Tab token for the wait that owns `fc_bbp_live`.
 * sessionStorage survives a reload in this tab. A new web tab does not have it.
 * A Tauri restart creates a new webview process, so this token is gone there too
 * (wry/WebView2/WebKit session storage is not the localStorage partition; not runtime-checked on desktop).
 */
const BBP_LIVE_GEN_KEY = 'fc_bbp_live_gen';

type LiveBbpRecord = { v: 2; generation: string; startMs: number; points: BbpPoint[]; events?: LogEntry[] };

const browserStorage = (kind: 'localStorage' | 'sessionStorage'): Storage | null => {
    try {
        const storage = globalThis[kind];
        if (!storage || typeof storage.getItem !== 'function') return null;
        return storage;
    } catch {
        return null;
    }
};

const clearLiveStorage = () => {
    try {
        browserStorage('localStorage')?.removeItem(BBP_LIVE_KEY);
    } catch {
        // private mode
    }
    try {
        browserStorage('sessionStorage')?.removeItem(BBP_LIVE_GEN_KEY);
    } catch {
        // private mode
    }
};

const isLivePoint = (point: unknown): point is BbpPoint => {
    if (!point || typeof point !== 'object') return false;
    const sample = point as BbpPoint;
    return Number.isFinite(sample.t) && Number.isFinite(sample.bt);
};

const isLiveEvent = (event: unknown): event is LogEntry => {
    if (!event || typeof event !== 'object') return false;
    const row = event as LogEntry;
    return (
        typeof row.event === 'string' &&
        isBbpAllowedEvent(row.event) &&
        typeof row.timeSec === 'number' &&
        Number.isFinite(row.timeSec)
    );
};

/** v2 generation, or null when the blob is missing, legacy, or unreadable. */
const storedGeneration = (): string | null => {
    const local = browserStorage('localStorage');
    if (!local) return null;
    try {
        const raw = local.getItem(BBP_LIVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<LiveBbpRecord> | null;
        return parsed?.v === 2 && typeof parsed.generation === 'string' && parsed.generation.length > 0
            ? parsed.generation
            : null;
    } catch {
        return null;
    }
};

/**
 * `claim` is begin(): this tab takes the blob.
 * Later appends stop once another tab's begin() has claimed it.
 */
const persistLive = (
    active: boolean,
    generation: string,
    startMs: number,
    points: BbpPoint[],
    events: LogEntry[],
    claim = false,
) => {
    const local = browserStorage('localStorage');
    const session = browserStorage('sessionStorage');
    if (!local) return;
    try {
        if (!active) {
            const stored = storedGeneration();
            if (stored && stored !== generation) return;
            clearLiveStorage();
            return;
        }
        const stored = storedGeneration();
        if (!claim && stored && stored !== generation) return;
        if (!session || !generation) throw new Error('BBP session token unavailable');
        const record: LiveBbpRecord = { v: 2, generation, startMs, points, events };
        local.setItem(BBP_LIVE_KEY, JSON.stringify(record));
        session.setItem(BBP_LIVE_GEN_KEY, generation);
    } catch {
        // ponytail: quota/private-mode — drop the blob so reload cannot restore an older wait
        clearLiveStorage();
    }
};

export const readLiveBbp = (): {
    generation: string;
    startMs: number;
    points: BbpPoint[];
    events: LogEntry[];
} | null => {
    const local = browserStorage('localStorage');
    const session = browserStorage('sessionStorage');
    if (!local) return null;
    try {
        const raw = local.getItem(BBP_LIVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<LiveBbpRecord> | null;
        const rawPoints = parsed?.points;
        const points = Array.isArray(rawPoints) ? rawPoints.filter(isLivePoint) : null;
        const events = Array.isArray(parsed?.events) ? parsed.events.filter(isLiveEvent) : [];
        const generation = parsed?.generation;
        const startMs = parsed?.startMs;
        const token = session?.getItem(BBP_LIVE_GEN_KEY);
        const v2 =
            parsed?.v === 2 &&
            typeof generation === 'string' &&
            generation.length > 0 &&
            typeof startMs === 'number' &&
            startMs > 0 &&
            points != null &&
            points.length === rawPoints?.length;
        if (!v2) {
            clearLiveStorage();
            return null;
        }
        // Missing or different token: new tab, app restart, or the other tab owns the blob. Leave their blob.
        if (token !== generation) return null;
        return { generation, startMs, points, events };
    } catch {
        clearLiveStorage();
        return null;
    }
};

export const useBbpStore = create<BbpState>((set, get) => ({
    active: false,
    recording: false,
    liveGeneration: '',
    startMs: 0,
    points: [],
    events: [],
    finalized: null,
    finalizedPoints: [],
    finalizedCapture: null,

    // finalized는 건드리지 않는다 — 직전 세션이 아직 저장 전일 수 있다
    begin: (startMs, seed = [], recording = true) => {
        const points = seed.length > 0 ? clipBbpWindow(seed, seed[seed.length - 1]?.t ?? 0) : [];
        // Chart-only preheat must not claim this tab's token or touch another tab's blob.
        if (!recording) {
            set({ active: true, recording: false, liveGeneration: '', startMs, points, events: [] });
            return;
        }
        const liveGeneration = crypto.randomUUID();
        persistLive(true, liveGeneration, startMs, points, [], true);
        set({ active: true, recording: true, liveGeneration, startMs, points, events: [] });
    },

    append: (sample, nowMs) => {
        const { active, recording, liveGeneration, startMs, points, events } = get();
        if (!active) return;
        if (recording && !liveGeneration) return;
        const t = (nowMs - startMs) / 1000;
        if (t < 0) return;
        if (points.length > 0 && t - points[points.length - 1].t < 1) return;
        const next = clipBbpWindow([...points, { t, ...sample }], t);
        // Sample retention must not erase notes accepted ahead of the latest reading.
        if (recording) persistLive(true, liveGeneration, startMs, next, events);
        set({ points: next });
    },

    setEvents: (action) => {
        const { active, recording, liveGeneration, startMs, points, events } = get();
        if (!active) return;
        const next = typeof action === 'function' ? action(events) : action;
        const allowed = next.filter(
            (entry) => isBbpAllowedEvent(entry.event) && entry.timeSec != null && Number.isFinite(entry.timeSec),
        );
        if (recording && liveGeneration) persistLive(true, liveGeneration, startMs, points, allowed);
        set({ events: allowed });
    },

    abort: () => {
        persistLive(false, get().liveGeneration, 0, [], []);
        set({ active: false, recording: false, liveGeneration: '', startMs: 0, points: [], events: [] });
    },

    finalize: (chargeMs, sessionId) => {
        const { active, recording, liveGeneration, startMs, points, events } = get();
        const capture = captureBatchBbp(
            { active, liveGeneration, startMs, recording, points, events },
            sessionId,
            chargeMs,
        );
        const result = capture ? splitBatchBbp(capture, BBP_MAX_SECONDS) : null;
        persistLive(false, liveGeneration, 0, [], []);
        set({
            active: false,
            recording: false,
            liveGeneration: '',
            startMs: 0,
            points: [],
            events: [],
            finalized: result?.bbp
                ? {
                      sessionId,
                      seconds: result.bbp.seconds,
                      chargeTemp: result.bbp.chargeTemp,
                      events: result.bbp.events,
                  }
                : null,
            finalizedPoints: result?.before ?? [],
            finalizedCapture: capture,
        });
        return result?.bbp ?? null;
    },
}));

export const hydrateLiveBbp = (): boolean => {
    const current = useBbpStore.getState();
    const live = readLiveBbp();
    if (current.active && current.liveGeneration) {
        return live?.generation === current.liveGeneration;
    }
    if (!live) return false;
    const endT = live.points[live.points.length - 1]?.t ?? 0;
    useBbpStore.setState({
        active: true,
        recording: true,
        liveGeneration: live.generation,
        startMs: live.startMs,
        points: clipBbpWindow(live.points, endT),
        events: live.events,
    });
    return true;
};
