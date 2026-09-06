import { logger } from '@shared/lib/logger';
import type { LogEntry } from '@shared/types/roast';

/**
 * Crash/reload journal for Charge–Drop. Separate from the R2 TSV (#104)
 * and from sidecar recorder (#308). Pending save (`fc_pending_roast_save`)
 * covers End confirm onward.
 */
export type LiveRoastDraftPoint = {
    time: number;
    label: string;
    bt: number;
    et: number | null;
    ror: number | null;
    ror_et: number | null;
    heater: number | null;
    fan: number;
    drum: number;
};

export type LiveRoastDraft = {
    version: 1;
    sessionId: string;
    roastStartMs: number;
    elapsed: number;
    livePoints: LiveRoastDraftPoint[];
    logEntries: LogEntry[];
    updatedAt: number;
};

export const LIVE_ROAST_DRAFT_KEY = 'fc_live_roast_draft';

const WRITE_DEBOUNCE_MS = 200;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDraft: LiveRoastDraft | null = null;

const isDraft = (value: unknown): value is LiveRoastDraft => {
    if (value == null || typeof value !== 'object') return false;
    const v = value as Partial<LiveRoastDraft>;
    return (
        v.version === 1 &&
        typeof v.sessionId === 'string' &&
        v.sessionId.length > 0 &&
        typeof v.roastStartMs === 'number' &&
        v.roastStartMs > 0 &&
        Array.isArray(v.livePoints) &&
        Array.isArray(v.logEntries)
    );
};

export const readLiveRoastDraft = (): LiveRoastDraft | null => {
    try {
        const raw = localStorage.getItem(LIVE_ROAST_DRAFT_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isDraft(parsed) ? parsed : null;
    } catch (err) {
        logger.capture(err, { scope: 'liveRoastDraft.read' });
        return null;
    }
};

export const writeLiveRoastDraft = (draft: LiveRoastDraft): void => {
    try {
        localStorage.setItem(LIVE_ROAST_DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
        logger.capture(err, { scope: 'liveRoastDraft.write' });
    }
};

export const scheduleLiveRoastDraftWrite = (draft: LiveRoastDraft, delayMs = WRITE_DEBOUNCE_MS): void => {
    pendingDraft = draft;
    if (writeTimer != null) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        const next = pendingDraft;
        pendingDraft = null;
        if (next) writeLiveRoastDraft(next);
    }, delayMs);
};

export const flushLiveRoastDraftWrite = (): void => {
    if (writeTimer != null) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    if (pendingDraft) {
        const next = pendingDraft;
        pendingDraft = null;
        writeLiveRoastDraft(next);
    }
};

export const clearLiveRoastDraft = (): void => {
    if (writeTimer != null) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    pendingDraft = null;
    try {
        localStorage.removeItem(LIVE_ROAST_DRAFT_KEY);
    } catch (err) {
        logger.capture(err, { scope: 'liveRoastDraft.clear' });
    }
};
