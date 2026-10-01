import type { MachineSnapshot } from '@entities/machine';
import { logger } from '@shared/lib/logger';
import { resumeSessionTsv } from '@shared/lib/tsv-writer';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import type { BatchSelection } from './batchSelection';
import { useRoastingStore } from './status';

/**
 * Same-tab journal for Charge until Drop/reset.
 * sessionStorage survives a document reload and is empty in a new tab, so a
 * second tab cannot poll the same session.
 * ponytail: app restart and a new tab do not restore — upgrade path is a
 * localStorage blob plus a tab lease, same as the BBP wait.
 */
export const LIVE_ROAST_DRAFT_KEY = 'fc_live_roast_draft';

const WRITE_DEBOUNCE_MS = 200;

export type LiveRoastDraft = {
    version: 1;
    sessionId: string;
    sessionOwnerId: string | null;
    roastStartMs: number;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    fcDualUnwind: boolean;
    heatHoldAfterDrop: boolean;
    currentBatch: BatchSelection | null;
    prepared: BatchSelection;
    machineSnapshot: MachineSnapshot | null;
};

const storage = (): Storage | null => {
    try {
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isSelection = (value: unknown): value is BatchSelection => {
    if (!value || typeof value !== 'object') return false;
    const selection = value as BatchSelection;
    const text = (field: unknown) => field === null || typeof field === 'string';
    return (
        text(selection.selectedBeanId) &&
        text(selection.targetProfileId) &&
        text(selection.handoffBeanName) &&
        (selection.planBatchHandoff === null || typeof selection.planBatchHandoff === 'object')
    );
};

const isPoint = (value: unknown): value is LiveRoastPoint => {
    if (!value || typeof value !== 'object') return false;
    const point = value as Partial<LiveRoastPoint>;
    const nullable = (field: unknown) => field === null || field === undefined || typeof field === 'number';
    return (
        isFiniteNumber(point.time) &&
        typeof point.label === 'string' &&
        isFiniteNumber(point.bt) &&
        nullable(point.et) &&
        nullable(point.ror) &&
        nullable(point.ror_et) &&
        nullable(point.heater) &&
        isFiniteNumber(point.fan) &&
        isFiniteNumber(point.drum)
    );
};

const isLog = (value: unknown): value is LogEntry => {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<LogEntry>;
    return typeof entry.event === 'string' && typeof entry.time === 'string';
};

const isSnapshot = (value: unknown): value is MachineSnapshot => {
    if (!value || typeof value !== 'object') return false;
    const snap = value as MachineSnapshot;
    return ['machine_id', 'machine_name', 'machine_roaster_key', 'machine_brand', 'machine_protocol'].every((key) => {
        const field = snap[key as keyof MachineSnapshot];
        return field === null || typeof field === 'string';
    });
};

const isDraft = (value: unknown): value is LiveRoastDraft => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<LiveRoastDraft>;
    return (
        draft.version === 1 &&
        typeof draft.sessionId === 'string' &&
        /^[0-9a-zA-Z-]+$/.test(draft.sessionId) &&
        (draft.sessionOwnerId === null || typeof draft.sessionOwnerId === 'string') &&
        isFiniteNumber(draft.roastStartMs) &&
        draft.roastStartMs > 0 &&
        Array.isArray(draft.logEntries) &&
        draft.logEntries.every(isLog) &&
        Array.isArray(draft.livePoints) &&
        draft.livePoints.every(isPoint) &&
        typeof draft.fcDualUnwind === 'boolean' &&
        typeof draft.heatHoldAfterDrop === 'boolean' &&
        (draft.currentBatch === null || isSelection(draft.currentBatch)) &&
        isSelection(draft.prepared) &&
        (draft.machineSnapshot === null || isSnapshot(draft.machineSnapshot))
    );
};

export const readLiveRoastDraft = (): LiveRoastDraft | null => {
    const bin = storage();
    if (!bin) return null;
    try {
        const raw = bin.getItem(LIVE_ROAST_DRAFT_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isDraft(parsed)) {
            bin.removeItem(LIVE_ROAST_DRAFT_KEY);
            return null;
        }
        return parsed;
    } catch (err) {
        // Corrupt JSON is discarded. Other failures (storage access) are unexpected.
        if (!(err instanceof SyntaxError)) logger.capture(err, { scope: 'liveRoastDraft.read' });
        try {
            bin.removeItem(LIVE_ROAST_DRAFT_KEY);
        } catch {
            // private mode
        }
        return null;
    }
};

const writeLiveRoastDraft = (draft: LiveRoastDraft): void => {
    const bin = storage();
    if (!bin) return;
    try {
        bin.setItem(LIVE_ROAST_DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
        logger.capture(err, { scope: 'liveRoastDraft.write' });
    }
};

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDraft: LiveRoastDraft | null = null;

export const flushLiveRoastDraftWrite = (): void => {
    if (writeTimer != null) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    const next = pendingDraft;
    pendingDraft = null;
    if (next) writeLiveRoastDraft(next);
};

const scheduleWrite = (draft: LiveRoastDraft): void => {
    pendingDraft = draft;
    if (writeTimer != null) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        const next = pendingDraft;
        pendingDraft = null;
        if (next) writeLiveRoastDraft(next);
    }, WRITE_DEBOUNCE_MS);
};

export const clearLiveRoastDraft = (): void => {
    if (writeTimer != null) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    pendingDraft = null;
    held = null;
    journaled = false;
    try {
        storage()?.removeItem(LIVE_ROAST_DRAFT_KEY);
    } catch (err) {
        logger.capture(err, { scope: 'liveRoastDraft.clear' });
    }
};

type Held = {
    sessionId: string;
    roastStartMs: number;
    sessionOwnerId: string | null;
    fcDualUnwind: boolean;
    heatHoldAfterDrop: boolean;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    currentBatch: BatchSelection | null;
    prepared: BatchSelection;
    machineSnapshot: MachineSnapshot | null;
};

let held: Held | null = null;
let journaled = false;

const draftFrom = (state: {
    sessionId: string;
    sessionOwnerId: string | null;
    roastStartMs: number;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    fcDualUnwind: boolean;
    heatHoldAfterDrop: boolean;
    currentBatch: BatchSelection | null;
    prepared: BatchSelection;
    machineSnapshot: MachineSnapshot | null;
}): LiveRoastDraft => ({
    version: 1,
    sessionId: state.sessionId,
    sessionOwnerId: state.sessionOwnerId,
    roastStartMs: state.roastStartMs,
    logEntries: state.logEntries,
    livePoints: state.livePoints,
    fcDualUnwind: state.fcDualUnwind,
    heatHoldAfterDrop: state.heatHoldAfterDrop,
    currentBatch: state.currentBatch,
    prepared: state.prepared,
    machineSnapshot: state.machineSnapshot,
});

const changed = (state: Held & { sessionId: string | null }): boolean => {
    if (!held || !state.sessionId) return true;
    return (
        held.sessionId !== state.sessionId ||
        held.roastStartMs !== state.roastStartMs ||
        held.sessionOwnerId !== state.sessionOwnerId ||
        held.fcDualUnwind !== state.fcDualUnwind ||
        held.heatHoldAfterDrop !== state.heatHoldAfterDrop ||
        held.logEntries !== state.logEntries ||
        held.livePoints !== state.livePoints ||
        held.currentBatch !== state.currentBatch ||
        held.prepared !== state.prepared ||
        held.machineSnapshot !== state.machineSnapshot
    );
};

const sync = (): void => {
    const state = useRoastingStore.getState();
    if (state.phase === 'roasting' && state.sessionId && state.roastStartMs > 0) {
        if (!changed(state)) return;
        held = {
            sessionId: state.sessionId,
            roastStartMs: state.roastStartMs,
            sessionOwnerId: state.sessionOwnerId,
            fcDualUnwind: state.fcDualUnwind,
            heatHoldAfterDrop: state.heatHoldAfterDrop,
            logEntries: state.logEntries,
            livePoints: state.livePoints,
            currentBatch: state.currentBatch,
            prepared: state.prepared,
            machineSnapshot: state.machineSnapshot,
        };
        journaled = true;
        scheduleWrite(draftFrom({ ...state, sessionId: state.sessionId }));
        return;
    }
    if (!journaled) return;
    clearLiveRoastDraft();
};

let unsubscribe: (() => void) | null = null;

export const bindLiveRoastDraft = (): void => {
    if (unsubscribe) return;
    const unsub = useRoastingStore.subscribe(sync);
    const flush = () => flushLiveRoastDraftWrite();
    window.addEventListener('pagehide', flush);
    unsubscribe = () => {
        unsub();
        window.removeEventListener('pagehide', flush);
        unsubscribe = null;
        if (writeTimer != null) {
            clearTimeout(writeTimer);
            writeTimer = null;
        }
        pendingDraft = null;
        held = null;
        journaled = false;
    };
};

/** Test-only: drop the subscriber without deleting a journal already flushed. */
export const unbindLiveRoastDraftForTests = (): void => {
    unsubscribe?.();
};

/**
 * Restore a same-tab reload before the roast screen renders.
 * Idle-only: an in-memory session (remount) is left alone.
 * Returns true when the journal became the live session.
 */
export const hydrateLiveRoastDraft = (): boolean => {
    try {
        const state = useRoastingStore.getState();
        if (state.phase !== 'idle' || state.sessionId) return false;
        const draft = readLiveRoastDraft();
        if (!draft) return false;
        resumeSessionTsv(draft.sessionId);
        const initializedTsvSessions = new Set(state.initializedTsvSessions);
        initializedTsvSessions.add(draft.sessionId);
        useRoastingStore.setState({
            phase: 'roasting',
            sessionId: draft.sessionId,
            sessionOwnerId: draft.sessionOwnerId,
            roastStartMs: draft.roastStartMs,
            elapsed: Math.max(0, Math.floor((Date.now() - draft.roastStartMs) / 1000)),
            logEntries: draft.logEntries,
            livePoints: draft.livePoints,
            fcDualUnwind: draft.fcDualUnwind,
            heatHoldAfterDrop: draft.heatHoldAfterDrop,
            currentBatch: draft.currentBatch,
            prepared: draft.prepared,
            machineSnapshot: draft.machineSnapshot,
            awaitingNextCharge: false,
            initializedTsvSessions,
        });
        return true;
    } catch (err) {
        logger.capture(err, { scope: 'liveRoastDraft.hydrate' });
        return false;
    }
};
