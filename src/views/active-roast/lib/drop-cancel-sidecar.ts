import type { RoastPhase } from '@features/active-roast/model/batch';
import { isLiveDetachedFromPending } from '../model/useRoastSaveFlow';

/** Don't Save must not /reset while another batch owns the machine (#607 / #749). */
export const shouldResetSidecarAfterSummaryDiscard = (
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean },
    pendingSessionId: string | null | undefined,
    discardApplied: boolean,
): boolean => {
    if (!discardApplied || !pendingSessionId) return false;
    if (isLiveDetachedFromPending(live, pendingSessionId)) return false;
    return true;
};
