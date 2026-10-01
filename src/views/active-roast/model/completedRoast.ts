import { canCancelDrop } from '@features/active-roast/lib/drop-transition';
import { isChargedPhase, type RoastingState, useRoastingStore } from '@features/active-roast/model/status';

export type { CompletedRoastRestore } from '@features/active-roast/model/completed';

const completedState = (state: RoastingState) => {
    const record = state.latestCompletedKey ? state.completedRecords[state.latestCompletedKey] : null;
    return {
        restore: record?.restore ?? null,
        droppedSessionId: record?.sessionId ?? null,
        submitted: Boolean(record?.submitted || record?.saving),
        capture: state.capture,
        markSubmitted: state.markSubmitted,
        lockAfterCharge: state.lockAfterCharge,
        clear: state.clear,
    };
};

// Compatibility selectors; the running store owns the records and action boundary.
export const useCompletedRoastStore = Object.assign(
    <T>(selector: (state: ReturnType<typeof completedState>) => T): T =>
        useRoastingStore((state) => selector(completedState(state))),
    { getState: () => completedState(useRoastingStore.getState()) },
);

export const isDropCancelable = (key?: string | null): boolean => {
    const live = useRoastingStore.getState();
    const record =
        (key ?? live.latestCompletedKey) ? live.completedRecords[key ?? live.latestCompletedKey ?? ''] : null;
    const restore = record?.restore;
    if (!restore || !record.cancelable || record.saving || record.submitted) return false;
    const nextCharged = Boolean(isChargedPhase(live.phase) && live.sessionId && live.sessionId !== restore.sessionId);
    return canCancelDrop({ nextCharged, submitted: record.submitted });
};
