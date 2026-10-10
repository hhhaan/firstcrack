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
