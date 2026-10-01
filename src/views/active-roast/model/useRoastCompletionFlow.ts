import { completedKey } from '@features/active-roast/model/completed';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import type { RoastSummaryData } from '@shared/types/roast';
import { useCallback } from 'react';

export type { RoastSummaryData } from '@shared/types/roast';

export interface SaveFlowResult {
    sessionId?: string | null;
    sessionOwnerId?: string | null;
    shouldOpenContinue: boolean;
    continueCandidates?: PlanBatchWithProgress[];
}

interface FlowState {
    endRoastModal: boolean;
    summaryModal: boolean;
    summaryData: RoastSummaryData | null;
    continueModal: boolean;
    continueCandidates: PlanBatchWithProgress[];
}

export interface UseRoastCompletionFlowReturn extends FlowState {
    openEndRoast: () => void;
    confirmEndRoast: (summaryData: RoastSummaryData) => void;
    closeEndRoast: () => void;
    closeSummary: () => void;
    reopenSummary: () => void;
    discardSummary: () => void;
    onSaveSuccess: (result: SaveFlowResult) => void;
    dismissContinue: () => void;
    resetFlow: () => void;
}

export const useRoastCompletionFlow = (): UseRoastCompletionFlowReturn => {
    const ui = useRoastingStore((s) => s.completionUi);
    const summaryData = useRoastingStore((s) =>
        ui.summaryKey ? (s.completedRecords[ui.summaryKey]?.summary ?? null) : null,
    );
    const store = useRoastingStore.getState();
    const confirmEndRoast = useCallback((summary: RoastSummaryData) => {
        if (summary.sessionId)
            useRoastingStore.getState().openCompleted(completedKey(summary.sessionOwnerId ?? '', summary.sessionId));
    }, []);
    const reopenSummary = useCallback(() => {
        if (ui.summaryKey) useRoastingStore.getState().openCompleted(ui.summaryKey);
    }, [ui.summaryKey]);
    const onSaveSuccess = useCallback((result: SaveFlowResult) => {
        if (result.sessionId)
            useRoastingStore
                .getState()
                .saveSucceeded(
                    completedKey(result.sessionOwnerId ?? '', result.sessionId),
                    result.shouldOpenContinue ? result.continueCandidates : [],
                );
    }, []);
    return {
        endRoastModal: ui.endRoastModal,
        summaryModal: ui.summaryModal,
        summaryData,
        continueModal: ui.continueModal,
        continueCandidates: ui.continueCandidates,
        openEndRoast: store.openEndRoast,
        confirmEndRoast,
        closeEndRoast: store.closeEndRoast,
        closeSummary: store.closeSummary,
        reopenSummary,
        discardSummary: store.clearSummarySelection,
        onSaveSuccess,
        dismissContinue: store.dismissContinue,
        resetFlow: store.resetCompletionUi,
    };
};
