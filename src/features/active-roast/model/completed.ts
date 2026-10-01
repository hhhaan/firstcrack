import type { MachineSnapshot } from '@entities/machine';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import type { LiveRoastPoint, LogEntry, RoastSummaryData } from '@shared/types/roast';
import type { RoastSummaryForm } from '../lib/roastSummarySchema';
import type { BatchSelection } from './batchSelection';
import type { FinalizedBbp } from './bbp';
import type { PendingRoastParams } from './pendingRoastSave';

export const completedKey = (ownerId: string | null, sessionId: string) => JSON.stringify([ownerId ?? '', sessionId]);

export interface CompletedRoastRestore {
    sessionId: string;
    roastStartMs: number;
    elapsed: number;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    sessionOwnerId: string | null;
    currentBatch?: BatchSelection | null;
    machineSnapshot?: MachineSnapshot | null;
    bbpSummary?: FinalizedBbp | null;
    rawBT?: number | null;
}

export interface CompletedRecord {
    ownerId: string;
    sessionId: string;
    createdAt: number;
    summary: RoastSummaryData | null;
    params: PendingRoastParams | null;
    restore: CompletedRoastRestore | null;
    waitPoints: LiveRoastPoint[];
    draft: RoastSummaryForm | null;
    saving: boolean;
    submitted: boolean;
    cancelable: boolean;
}

export interface CompletionUi {
    endRoastModal: boolean;
    summaryModal: boolean;
    summaryKey: string | null;
    continueModal: boolean;
    continueCandidates: PlanBatchWithProgress[];
}
const emptyUi: CompletionUi = {
    endRoastModal: false,
    summaryModal: false,
    summaryKey: null,
    continueModal: false,
    continueCandidates: [],
};

export interface CompletedSlice {
    completionUi: CompletionUi;
    openEndRoast: () => void;
    closeEndRoast: () => void;
    openCompleted: (key: string) => void;
    closeSummary: () => void;
    clearSummarySelection: () => void;
    dismissContinue: () => void;
    resetCompletionUi: () => void;
    saveSucceeded: (key: string, candidates?: PlanBatchWithProgress[]) => void;
    completedRecords: Record<string, CompletedRecord>;
    latestCompletedKey: string | null;
    capture: (restore: CompletedRoastRestore) => void;
    freezeCompleted: (summary: RoastSummaryData, params: PendingRoastParams) => void;
    hydrateCompleted: (summary: RoastSummaryData, params: PendingRoastParams) => void;
    setCompletedDraft: (key: string, draft: RoastSummaryForm) => void;
    beginCompletedSave: (key: string) => boolean;
    finishCompletedSave: (key: string) => void;
    markSubmitted: (sessionId: string, ownerId?: string) => void;
    lockAfterCharge: (liveSessionId: string | null) => void;
    appendCompletedWait: (point: LiveRoastPoint, atMs: number) => void;
    discardCompleted: (key: string) => boolean;
    clear: () => void;
}

// A slice of the running store: synchronous actions fence every batch mutation.
export const createCompletedSlice = (
    set: (patch: Partial<CompletedSlice>) => void,
    get: () => CompletedSlice,
): CompletedSlice => {
    const patchRecord = (key: string, patch: Partial<CompletedRecord>) => {
        const state = get();
        const record = state.completedRecords[key];
        if (!record) return;
        set({ completedRecords: { ...state.completedRecords, [key]: { ...record, ...patch } } });
    };
    const freeze = (summary: RoastSummaryData, params: PendingRoastParams, latest = true) => {
        if (!params.sessionId) return;
        const key = completedKey(params.userId, params.sessionId);
        const existing = get().completedRecords[key];
        // Hydration never fills a legacy record from the active batch.
        const record: CompletedRecord = existing
            ? { ...existing }
            : {
                  ownerId: params.userId,
                  sessionId: params.sessionId,
                  createdAt: Date.now(),
                  summary: { ...summary, sessionId: params.sessionId, sessionOwnerId: params.userId },
                  params: structuredClone(params),
                  restore: null,
                  waitPoints: [],
                  draft: null,
                  saving: false,
                  submitted: false,
                  cancelable: false,
              };
        if (!existing?.params) {
            record.params = structuredClone(params);
            record.summary = { ...summary, sessionId: params.sessionId, sessionOwnerId: params.userId };
        }
        set({
            completedRecords: { ...get().completedRecords, [key]: record },
            ...(latest ? { latestCompletedKey: key } : {}),
        });
    };
    return {
        completedRecords: {},
        latestCompletedKey: null,
        completionUi: emptyUi,
        openEndRoast: () => set({ completionUi: { ...get().completionUi, endRoastModal: true } }),
        closeEndRoast: () => set({ completionUi: { ...get().completionUi, endRoastModal: false } }),
        openCompleted: (key) => {
            if (!get().completedRecords[key]?.summary || get().completedRecords[key].submitted) return;
            set({ completionUi: { ...get().completionUi, endRoastModal: false, summaryModal: true, summaryKey: key } });
        },
        closeSummary: () => set({ completionUi: { ...get().completionUi, summaryModal: false } }),
        clearSummarySelection: () => set({ completionUi: emptyUi }),
        dismissContinue: () =>
            set({ completionUi: { ...get().completionUi, continueModal: false, continueCandidates: [] } }),
        resetCompletionUi: () => set({ completionUi: emptyUi }),
        saveSucceeded: (key, candidates = []) => {
            patchRecord(key, { submitted: true, saving: false, restore: null, cancelable: false });
            const ui = get().completionUi;
            if (ui.summaryKey != null && ui.summaryKey !== key) return;
            set({
                completionUi: {
                    ...ui,
                    summaryModal: false,
                    summaryKey: null,
                    continueModal: candidates.length > 0,
                    continueCandidates: candidates,
                },
            });
        },
        capture: (restore) => {
            const key = completedKey(restore.sessionOwnerId, restore.sessionId);
            if (get().completedRecords[key]) return;
            set({
                latestCompletedKey: key,
                completedRecords: {
                    ...get().completedRecords,
                    [key]: {
                        ownerId: restore.sessionOwnerId ?? '',
                        sessionId: restore.sessionId,
                        createdAt: Date.now(),
                        summary: null,
                        params: null,
                        restore: structuredClone(restore),
                        waitPoints: [],
                        draft: null,
                        saving: false,
                        submitted: false,
                        cancelable: true,
                    },
                },
            });
        },
        freezeCompleted: freeze,
        hydrateCompleted: (summary, params) => freeze(summary, params, false),
        setCompletedDraft: (key, draft) => {
            if (!get().completedRecords[key]?.saving) patchRecord(key, { draft: structuredClone(draft) });
        },
        beginCompletedSave: (key) => {
            const record = get().completedRecords[key];
            if (!record || record.saving || record.submitted) return false;
            patchRecord(key, { saving: true });
            return true;
        },
        finishCompletedSave: (key) => patchRecord(key, { saving: false }),
        markSubmitted: (sessionId, ownerId) => {
            for (const [key, record] of Object.entries(get().completedRecords)) {
                if (record.sessionId === sessionId && (ownerId === undefined || record.ownerId === ownerId))
                    patchRecord(key, { submitted: true, saving: false, restore: null, cancelable: false });
            }
        },
        lockAfterCharge: (sessionId) => {
            if (!sessionId) return;
            for (const [key, record] of Object.entries(get().completedRecords)) {
                if (record.sessionId !== sessionId)
                    patchRecord(key, { restore: null, cancelable: false, waitPoints: [] });
            }
        },
        appendCompletedWait: (point, atMs) => {
            const key = get().latestCompletedKey;
            const record = key ? get().completedRecords[key] : null;
            const restore = record?.restore;
            if (!key || !record?.cancelable || !restore) return;
            const time = (atMs - restore.roastStartMs) / 1000;
            const last =
                record.waitPoints[record.waitPoints.length - 1] ?? restore.livePoints[restore.livePoints.length - 1];
            if (!Number.isFinite(time) || time <= restore.elapsed || (last && time - last.time < 0.4)) return;
            if (
                point.sensorTimestamp != null &&
                last?.sensorClock === point.sensorClock &&
                last.sensorTimestamp != null &&
                point.sensorTimestamp <= last.sensorTimestamp
            )
                return;
            patchRecord(key, {
                waitPoints: [
                    ...record.waitPoints,
                    {
                        ...point,
                        time,
                        label: `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`,
                    },
                ],
            });
        },
        discardCompleted: (key) => {
            if (!get().completedRecords[key] || get().completedRecords[key].saving) return false;
            const records = { ...get().completedRecords };
            delete records[key];
            set({
                completedRecords: records,
                ...(get().latestCompletedKey === key ? { latestCompletedKey: null } : {}),
            });
            return true;
        },
        clear: () => set({ completedRecords: {}, latestCompletedKey: null, completionUi: emptyUi }),
    };
};
