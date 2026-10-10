import { isChargedPhase, type RoastPhase } from '@features/active-roast/model/batch';

/** Live roast session is not the summary being discarded (e.g. Charge B while A's modal is open). */
export const liveSessionDiffersFromPendingSummary = (
    live: { sessionId: string | null; phase: RoastPhase },
    pendingSessionId: string | null | undefined,
): boolean =>
    Boolean(
        pendingSessionId &&
            live.sessionId &&
            live.sessionId !== pendingSessionId &&
            (isChargedPhase(live.phase) || live.phase === 'roasting'),
    );

/** Don't Save must not /reset while another batch owns the machine (#607 / #749). */
export const shouldResetSidecarAfterSummaryDiscard = (
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean },
    pendingSessionId: string | null | undefined,
    discardApplied: boolean,
): boolean => {
    if (!discardApplied || !pendingSessionId) return false;
    if (liveSessionDiffersFromPendingSummary(live, pendingSessionId)) return false;
    return true;
};
