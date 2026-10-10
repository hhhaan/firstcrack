import type { PidRuntime } from '@entities/machine';
import type {
    CompletedRoastRestore,
    DropControlSnapshot,
    RoastPhase,
    RoastSummaryData,
} from '@features/active-roast/model/batch';
import { dropCancelWarningFromRestore } from './drop-cancel-control';
import { liveSessionDiffersFromPendingSummary, shouldResetSidecarAfterSummaryDiscard } from './drop-cancel-sidecar';
import { shouldSkipSidecarResetWhilePidEngaged } from './sidecar-reset-guard';

export type SummaryDiscardSidecarInput = {
    sessionId: string | null | undefined;
    hadSummaryBeforeDiscard: boolean;
    snapshotSessionId: string | null | undefined;
    summaryAfterDiscard: RoastSummaryData | null | undefined;
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean };
};

/** Whether Don't Save should POST /reset (ActiveRoast onDiscard wiring). */
export const planSummaryDiscardSidecarReset = (input: SummaryDiscardSidecarInput): boolean => {
    const discardApplied = Boolean(
        input.hadSummaryBeforeDiscard &&
            input.sessionId &&
            input.snapshotSessionId === input.sessionId &&
            input.summaryAfterDiscard === null,
    );
    return shouldResetSidecarAfterSummaryDiscard(input.live, input.sessionId, discardApplied);
};

/** Banner state after Cancel Drop (must match handleCancelDrop). */
export const cancelDropControlWarningAfterRestore = (restore: CompletedRoastRestore): DropControlSnapshot =>
    dropCancelWarningFromRestore(restore);

export type SaveSidecarResetInput = {
    sessionId: string | null;
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean; pid: PidRuntime | null };
};

/** Sidecar reset after successful save (including Drop → Save while awaiting Charge). */
export const shouldResetSidecarAfterSave = (input: SaveSidecarResetInput): boolean => {
    if (!input.sessionId) return false;
    if (liveSessionDiffersFromPendingSummary(input.live, input.sessionId)) return false;
    if (shouldSkipSidecarResetWhilePidEngaged(input.live.pid)) return false;
    return true;
};

/** ActiveRoast onDiscard: hadSummary from store, not the modal prop (#752 / M16). */
export const hadSummaryBeforeSummaryDiscard = (
    completed: { summary: RoastSummaryData | null } | null | undefined,
): boolean => Boolean(completed?.summary);

export type RunSummaryDiscardSidecarInput = {
    sessionId: string | null | undefined;
    completedBeforeDiscard: { summary: RoastSummaryData | null; snapshot: { sessionId: string } } | null | undefined;
    discardSummary: () => void;
    readLive: () => SummaryDiscardSidecarInput['live'] & {
        completed?: { summary: RoastSummaryData | null; snapshot: { sessionId: string } } | null;
    };
    resetSidecarRoast: () => void;
};

/** Mirrors ActiveRoast summary modal Don't Save → sidecar reset wiring (M4 / M16). */
export const runSummaryDiscardSidecarReset = (input: RunSummaryDiscardSidecarInput): void => {
    const sessionId = input.sessionId;
    const hadSummary = hadSummaryBeforeSummaryDiscard(input.completedBeforeDiscard);
    input.discardSummary();
    const live = input.readLive();
    if (
        planSummaryDiscardSidecarReset({
            sessionId,
            hadSummaryBeforeDiscard: hadSummary,
            snapshotSessionId: live.completed?.snapshot.sessionId,
            summaryAfterDiscard: live.completed?.summary,
            live,
        })
    ) {
        input.resetSidecarRoast();
    }
};

export type InvokeSidecarResetAfterSaveInput = {
    sessionId: string | null;
    readLive: () => SaveSidecarResetInput['live'];
    resetSidecarRoast: () => void;
};

/** Mirrors ActiveRoast onSidecarResetAfterSave (M14). */
export const invokeSidecarResetAfterSave = (input: InvokeSidecarResetAfterSaveInput): void => {
    if (!shouldResetSidecarAfterSave({ sessionId: input.sessionId, live: input.readLive() })) return;
    input.resetSidecarRoast();
};

/** Mirrors ActiveRoast handleCancelDrop banner after successful cancelDrop (M3). */
export const dropCancelBannerAfterSuccessfulCancel = (
    restore: CompletedRoastRestore | null | undefined,
): DropControlSnapshot | null => (restore ? cancelDropControlWarningAfterRestore(restore) : null);
