import type { MachineSnapshot } from '@entities/machine';
import { formatElapsed } from '@shared/lib/format';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import { buildDropSummary, type DropOnset, planDropTransition } from '../lib/drop-transition';
import { formatTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';

export type RoastPhase = 'idle' | 'preheating' | 'standby' | 'roasting' | 'ended';
export const isChargedPhase = (phase: RoastPhase): boolean => phase === 'roasting' || phase === 'ended';

export interface RoastSelection {
    blendId?: string | null;
    beanId: string | null;
    beanName: string | null;
    profileId: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
}
export interface PreparedRoast extends RoastSelection {
    workspaceOwnerId: string | null;
    sourceOrigin?: 'default' | 'profile' | 'user' | 'handoff';
    beanInitialized: boolean;
    profileInitialized: boolean;
    profileUserSelected: boolean;
}
export interface LastAdhocSave {
    beanId: string | null;
    weightKg: number;
    roastLevel: string | null;
}
export interface RoastSummaryData {
    totalTime: string;
    development: string;
    finalBt: string;
    logEntries: LogEntry[];
    sessionId?: string | null;
    elapsedSec?: number;
    selectedBeanId?: string | null;
    selectedBlendId?: string | null;
    planBatchHandoff?: PlanBatchHandoff | null;
    handoffBeanName?: string | null;
}
export interface CompletedRoastRestore {
    sessionId: string;
    sessionOwnerId: string | null;
    roastStartMs: number;
    elapsed: number;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    replayActive: boolean;
    selection: RoastSelection;
    machineSnapshot: MachineSnapshot | null;
}
export interface CompletedRoastSnapshot {
    sessionId: string;
    curveRecorded: boolean;
    sessionOwnerId: string | null;
    roastStartMs: number;
    elapsed: number;
    rawBT: number | null;
    selection: RoastSelection;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    machineSnapshot: MachineSnapshot | null;
}
export interface CompletedRoast {
    summary: RoastSummaryData | null;
    snapshot: CompletedRoastSnapshot;
    restore: CompletedRoastRestore | null;
    submitted: boolean;
}
export interface BatchState {
    phase: RoastPhase;
    sessionId: string | null;
    sessionOwnerId: string | null;
    elapsed: number;
    roastStartMs: number;
    logState: { entries: LogEntry[]; unwind: boolean };
    livePoints: LiveRoastPoint[];
    machineSnapshot: MachineSnapshot | null;
    sidecarConnected: boolean;
    awaitingNextCharge: boolean;
    heatHoldAfterDrop: boolean;
    pendingBeanId: string | null;
    pendingBeanName: string | null;
    pendingProfileId: string | null;
    pendingProfileSource: { beanId: string | null; blendId: string | null; name: string } | null;
    prepared: PreparedRoast;
    activeSelection: RoastSelection | null;
    completed: CompletedRoast | null;
    lastAdhocSave: LastAdhocSave | null;
    reviewSessionId: string | null;
}
export const emptySelection: RoastSelection = {
    blendId: null,
    beanId: null,
    beanName: null,
    profileId: null,
    planBatchHandoff: null,
};
export const initialBatchState = {
    prepared: {
        ...emptySelection,
        workspaceOwnerId: null,
        beanInitialized: false,
        profileInitialized: false,
        profileUserSelected: false,
    } as PreparedRoast,
    activeSelection: null as RoastSelection | null,
    completed: null as CompletedRoast | null,
    lastAdhocSave: null as LastAdhocSave | null,
    reviewSessionId: null as string | null,
};
export const selectRoastSelection = (state: BatchState): RoastSelection => state.activeSelection ?? state.prepared;
/** Saved curve to keep on the roast chart. Charge and a workspace change clear it. */
export const selectReviewSnapshot = (state: BatchState): CompletedRoastSnapshot | null => {
    const id = state.reviewSessionId;
    const snapshot = state.completed?.snapshot;
    if (!id || !snapshot || snapshot.sessionId !== id || isChargedPhase(state.phase)) return null;
    return snapshot;
};
export const selectDropCancelable = (state: BatchState): boolean => {
    const completed = state.completed;
    return Boolean(
        completed?.restore &&
            !completed.submitted &&
            !(isChargedPhase(state.phase) && state.sessionId && state.sessionId !== completed.snapshot.sessionId),
    );
};
const copySelection = (selection: RoastSelection): RoastSelection =>
    structuredClone({
        blendId: selection.blendId ?? null,
        beanId: selection.beanId,
        beanName: selection.beanName,
        profileId: selection.profileId,
        planBatchHandoff: selection.planBatchHandoff,
    });
const snapshotBatch = (state: BatchState, summary: RoastSummaryData, rawBT: number | null): CompletedRoastSnapshot => ({
    sessionId: summary.sessionId ?? state.sessionId ?? crypto.randomUUID(),
    curveRecorded: Boolean(summary.sessionId || state.sessionId),
    sessionOwnerId: state.sessionOwnerId,
    roastStartMs: state.roastStartMs,
    elapsed: summary.elapsedSec ?? state.elapsed,
    rawBT,
    selection: copySelection({
        ...selectRoastSelection(state),
        ...(summary.selectedBlendId !== undefined && { blendId: summary.selectedBlendId }),
        ...(summary.selectedBeanId !== undefined && { beanId: summary.selectedBeanId }),
        ...(summary.handoffBeanName !== undefined && { beanName: summary.handoffBeanName }),
        ...(summary.planBatchHandoff !== undefined && { planBatchHandoff: summary.planBatchHandoff }),
    }),
    logEntries: structuredClone(summary.logEntries),
    livePoints: structuredClone(state.livePoints),
    machineSnapshot: structuredClone(state.machineSnapshot),
});
const summaryForSnapshot = (summary: RoastSummaryData, snapshot: CompletedRoastSnapshot): RoastSummaryData => ({
    ...summary,
    sessionId: snapshot.sessionId,
    logEntries: snapshot.logEntries,
    selectedBlendId: snapshot.selection.blendId ?? null,
    selectedBeanId: snapshot.selection.beanId,
    planBatchHandoff: snapshot.selection.planBatchHandoff,
    handoffBeanName: snapshot.selection.beanName,
});
export type BatchActions = ReturnType<typeof createBatchActions>;
/** All actions below change memory only. Callers perform I/O using returned snapshots. */
export const createBatchActions = (
    set: (patch: Partial<BatchState>) => void,
    get: () => BatchState,
    resetCurrent: (patch: Partial<BatchState>) => void,
) => ({
    prepareWorkspace: (workspaceOwnerId: string | null) => {
        if (get().prepared.workspaceOwnerId === workspaceOwnerId) return;
        const previous = get().prepared;
        set({
            reviewSessionId: null,
            prepared: {
                ...(previous.workspaceOwnerId === null ? previous : initialBatchState.prepared),
                workspaceOwnerId,
            },
            ...(previous.workspaceOwnerId !== null && {
                pendingBeanId: null,
                pendingBeanName: null,
                pendingProfileId: null,
                pendingProfileSource: null,
            }),
        });
    },
    initializeBean: (beanId: string | null) => {
        const prepared = get().prepared;
        if (prepared.beanInitialized) return;
        set({ prepared: { ...prepared, beanId, sourceOrigin: 'default', beanInitialized: true } });
    },
    initializeProfile: (profileId: string | null) => {
        const state = get();
        if (isChargedPhase(state.phase) || state.prepared.profileUserSelected) return;
        if (state.prepared.profileInitialized && state.prepared.profileId === profileId) return;
        set({ prepared: { ...state.prepared, profileId, profileInitialized: true } });
    },
    prepareBean: (beanId: string | null, beanName: string | null = null) => {
        const state = get();
        set({
            prepared: {
                ...state.prepared,
                beanId,
                blendId: null,
                beanName,
                sourceOrigin: 'user',
                beanInitialized: true,
            },
        });
    },
    invalidatePreparedBean: (expectedBeanId: string) => {
        const state = get();
        if (state.activeSelection || state.prepared.beanId !== expectedBeanId) return;
        set({ prepared: { ...state.prepared, beanId: null, beanName: null } });
    },
    prepareBlend: (blendId: string | null, beanName: string | null = null) => {
        const state = get();
        if (isChargedPhase(state.phase)) return;
        set({
            prepared: {
                ...state.prepared,
                beanId: null,
                blendId,
                beanName,
                sourceOrigin: 'user',
                beanInitialized: true,
            },
        });
    },
    applyProfileSource: (
        source: { beanId: string | null; blendId: string | null; name: string } | null,
        requiresChoice = false,
    ) => {
        const state = get();
        const prepared = state.prepared;
        if (isChargedPhase(state.phase) || prepared.planBatchHandoff || prepared.sourceOrigin === 'user') return;
        if (!source && !requiresChoice && prepared.sourceOrigin !== 'profile') return;
        set({
            prepared: {
                ...prepared,
                beanId: source?.beanId ?? null,
                blendId: source?.blendId ?? null,
                beanName: source?.name ?? null,
                sourceOrigin: 'profile',
                beanInitialized: true,
            },
        });
    },
    commitProfile: (
        profileId: string | null,
        expectedSessionId: string | null,
        expectedWorkspaceOwnerId: string | null,
        source: BatchState['pendingProfileSource'] = null,
    ) => {
        const state = get();
        if (state.sessionId !== expectedSessionId || state.prepared.workspaceOwnerId !== expectedWorkspaceOwnerId)
            return false;
        set({
            prepared: {
                ...state.prepared,
                profileId,
                profileInitialized: true,
                profileUserSelected: true,
                ...(!isChargedPhase(state.phase) &&
                state.prepared.sourceOrigin === 'profile' &&
                !state.prepared.planBatchHandoff
                    ? { beanId: null, blendId: null, beanName: null }
                    : {}),
                ...(!isChargedPhase(state.phase) && source
                    ? {
                          beanId: source.beanId,
                          blendId: source.blendId,
                          beanName: source.name,
                          sourceOrigin: 'user',
                          beanInitialized: true,
                          planBatchHandoff: null,
                      }
                    : {}),
            },
            ...(state.activeSelection && { activeSelection: { ...state.activeSelection, profileId } }),
        });
        return true;
    },
    startBatch: (handoff: PlanBatchHandoff) => {
        set({
            prepared: {
                ...get().prepared,
                blendId: handoff.blendId ?? null,
                sourceOrigin: 'handoff',
                beanId: handoff.beanId ?? null,
                beanName: handoff.beanName || null,
                planBatchHandoff: structuredClone(handoff),
                beanInitialized: true,
            },
            pendingBeanId: null,
            pendingBeanName: null,
            pendingProfileId: handoff.profileId ?? null,
            pendingProfileSource: null,
        });
    },
    completeBatch: () =>
        set({
            prepared: { ...get().prepared, planBatchHandoff: null },
            pendingProfileId: null,
            pendingProfileSource: null,
        }),
    recordAdhocSave: (lastAdhocSave: LastAdhocSave) => set({ lastAdhocSave }),
    startCharge: (originMs?: number, ownerId?: string, charge?: { bt: number | null; unit: TemperatureUnit }) => {
        const state = get();
        if (isChargedPhase(state.phase)) return null;
        const now = Date.now();
        const origin = originMs != null && originMs > 0 && originMs <= now ? originMs : now;
        const sessionId = crypto.randomUUID();
        set({
            phase: 'roasting',
            reviewSessionId: null,
            sessionId,
            sessionOwnerId: ownerId || null,
            roastStartMs: origin,
            elapsed: Math.floor((now - origin) / 1000),
            awaitingNextCharge: false,
            heatHoldAfterDrop: false,
            activeSelection: copySelection(state.prepared),
            livePoints: [],
            ...(charge && {
                logState: {
                    entries: [
                        {
                            id: crypto.randomUUID(),
                            time: '0:00',
                            timeSec: 0,
                            event: 'Charge',
                            temp: formatTemp(charge.bt, charge.unit),
                            tempC: charge.bt,
                            note: 'Bean drop detected',
                        },
                    ],
                    unwind: false,
                },
            }),
            completed: state.completed ? { ...state.completed, restore: null } : null,
        });
        return sessionId;
    },
    resetCurrentBatch: (opts: { chargeWait?: boolean; keepHeatHold?: boolean } = {}) => {
        const state = get();
        const chargeWait = opts.chargeWait ?? state.awaitingNextCharge;
        resetCurrent({
            phase: state.sidecarConnected ? (chargeWait ? 'standby' : 'preheating') : 'idle',
            awaitingNextCharge: chargeWait,
            heatHoldAfterDrop: opts.keepHeatHold ?? false,
            activeSelection: null,
        });
    },
    drop: (input: {
        rawBT: number | null;
        unit: TemperatureUnit;
        onset?: DropOnset;
        replayActive: boolean;
        livePoints?: LiveRoastPoint[];
    }) => {
        const state = get();
        const planned = planDropTransition({
            sessionId: state.sessionId,
            charged: isChargedPhase(state.phase),
            phase: state.phase,
            roastStartMs: state.roastStartMs,
            elapsed: state.elapsed,
            rawBT: input.rawBT,
            unit: input.unit,
            logEntries: state.logState.entries,
            livePoints: input.livePoints ?? state.livePoints,
            onset: input.onset,
            droppedSessionId: state.completed?.snapshot.sessionId ?? null,
        });
        if (!planned) return null;
        const snapshot = snapshotBatch(state, planned.summary, planned.dropBt);
        snapshot.livePoints = structuredClone(
            (input.livePoints ?? state.livePoints).filter(
                (point) => Number.isFinite(point.time) && point.time <= planned.dropTimeSec,
            ),
        );
        const restore: CompletedRoastRestore = { ...snapshot, replayActive: input.replayActive };
        const summary = summaryForSnapshot(planned.summary, snapshot);
        resetCurrent({
            phase: state.sidecarConnected ? 'standby' : 'idle',
            awaitingNextCharge: true,
            heatHoldAfterDrop: true,
            activeSelection: null,
            completed: { summary, snapshot, restore, submitted: false },
        });
        return { ...planned, summary, snapshot };
    },
    abortRoast: (rawBT: number | null, unit: TemperatureUnit) => {
        const state = get();
        const sessionId = state.sessionId ?? crypto.randomUUID();
        const entries = [
            ...state.logState.entries,
            {
                id: crypto.randomUUID(),
                time: formatElapsed(state.elapsed),
                timeSec: state.elapsed,
                event: 'End',
                temp: formatTemp(rawBT, unit),
                tempC: rawBT,
                note: 'Roast complete',
            },
        ];
        const endSummary = buildDropSummary(entries, state.elapsed, rawBT, unit, sessionId);
        const snapshot = snapshotBatch(state, endSummary, rawBT);
        snapshot.curveRecorded = Boolean(state.sessionId);
        const summary = summaryForSnapshot(endSummary, snapshot);
        resetCurrent({
            phase: state.sidecarConnected ? 'standby' : 'idle',
            awaitingNextCharge: true,
            heatHoldAfterDrop: true,
            activeSelection: null,
            completed: { summary, snapshot, restore: null, submitted: false },
        });
        return summary;
    },
    recoverChargeWait: () => {
        const state = get();
        if (isChargedPhase(state.phase)) return;
        set({
            awaitingNextCharge: true,
            ...(state.sidecarConnected &&
                (state.phase === 'idle' || state.phase === 'preheating') && { phase: 'standby' as const }),
        });
    },
    cancelDrop: (expectedSessionId?: string | null) => {
        const state = get();
        if (
            !selectDropCancelable(state) ||
            (expectedSessionId !== undefined && state.completed?.snapshot.sessionId !== expectedSessionId)
        )
            return null;
        const restore = state.completed?.restore;
        if (!restore) return null;
        const elapsed = Math.max(0, restore.elapsed);
        set({
            phase: 'roasting',
            sessionId: restore.sessionId,
            sessionOwnerId: restore.sessionOwnerId,
            roastStartMs: Date.now() - elapsed * 1000,
            elapsed,
            awaitingNextCharge: false,
            heatHoldAfterDrop: false,
            logState: { entries: restore.logEntries.filter((entry) => entry.event !== 'Drop'), unwind: false },
            livePoints: restore.livePoints,
            activeSelection: copySelection(restore.selection),
            machineSnapshot: restore.machineSnapshot,
            completed: null,
        });
        return restore;
    },
    captureSummary: (summary: RoastSummaryData, fallbackOwnerId: string | null, rawBT: number | null) => {
        const state = get();
        const previous = state.completed;
        const snapshot =
            previous && previous.snapshot.sessionId === summary.sessionId
                ? previous.snapshot
                : snapshotBatch(state, summary, rawBT);
        const frozen = summaryForSnapshot(summary, snapshot);
        const ownedSnapshot = { ...snapshot, sessionOwnerId: snapshot.sessionOwnerId ?? fallbackOwnerId };
        set({
            completed: {
                summary: frozen,
                snapshot: ownedSnapshot,
                restore: previous?.snapshot.sessionId === snapshot.sessionId ? previous.restore : null,
                submitted: false,
            },
        });
        return ownedSnapshot;
    },
    saveSucceeded: (ownerId: string, sessionId: string | null) => {
        const completed = get().completed;
        if (!completed || completed.snapshot.sessionId !== sessionId || completed.snapshot.sessionOwnerId !== ownerId)
            return false;
        if (!completed.submitted)
            set({
                completed: { ...completed, summary: null, restore: null, submitted: true },
                reviewSessionId: isChargedPhase(get().phase) ? null : sessionId,
            });
        return true;
    },
    dismissCompletedReview: () => set({ reviewSessionId: null }),
    replaceReviewLog: (entries: LogEntry[]) => {
        const completed = get().completed;
        if (!get().reviewSessionId || !completed) return;
        set({
            completed: {
                ...completed,
                snapshot: { ...completed.snapshot, logEntries: entries },
            },
        });
    },
    discardSummary: (ownerId: string | null, sessionId: string | null) => {
        const completed = get().completed;
        if (!completed || completed.snapshot.sessionId !== sessionId || completed.snapshot.sessionOwnerId !== ownerId)
            return false;
        set({ completed: { ...completed, summary: null } });
        return true;
    },
});
