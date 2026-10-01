import type { PlanBatchWithProgress } from '@shared/types/database.types';
import type { RoastSummaryData } from '@shared/types/roast';
import { useCallback } from 'react';
import { create } from 'zustand';

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

const INITIAL_FLOW_STATE: FlowState = {
    endRoastModal: false,
    summaryModal: false,
    summaryData: null,
    continueModal: false,
    continueCandidates: [],
};

type FlowAction =
    | { type: 'OPEN_END_ROAST' }
    | { type: 'CONFIRM_END_ROAST'; payload: RoastSummaryData }
    | { type: 'CLOSE_END_ROAST' }
    | { type: 'CLOSE_SUMMARY' }
    | { type: 'REOPEN_SUMMARY' }
    | { type: 'DISCARD_SUMMARY' }
    | { type: 'SAVE_SUCCESS'; payload: SaveFlowResult }
    | { type: 'DISMISS_CONTINUE' }
    | { type: 'RESET' };

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
    switch (action.type) {
        case 'OPEN_END_ROAST':
            return { ...state, endRoastModal: true };

        case 'CONFIRM_END_ROAST':
            return {
                ...state,
                endRoastModal: false,
                summaryModal: true,
                summaryData: action.payload,
            };

        case 'CLOSE_END_ROAST':
            return { ...state, endRoastModal: false };

        // Keep summaryData so ended phase can reopen (#172). Wipe only on discard/save/reset.
        case 'CLOSE_SUMMARY':
            return { ...state, summaryModal: false };

        case 'REOPEN_SUMMARY':
            if (state.summaryData == null) return state;
            return { ...state, summaryModal: true };

        case 'DISCARD_SUMMARY':
            return { ...INITIAL_FLOW_STATE };

        case 'SAVE_SUCCESS': {
            if (
                state.summaryData &&
                (state.summaryData.sessionId !== action.payload.sessionId ||
                    state.summaryData.sessionOwnerId !== action.payload.sessionOwnerId)
            )
                return state;
            if (action.payload.shouldOpenContinue) {
                return {
                    ...state,
                    summaryModal: false,
                    summaryData: null,
                    continueModal: true,
                    continueCandidates: action.payload.continueCandidates ?? [],
                };
            }
            return {
                ...state,
                summaryModal: false,
                summaryData: null,
                continueModal: false,
                continueCandidates: [],
            };
        }

        case 'DISMISS_CONTINUE':
            return { ...state, continueModal: false, continueCandidates: [] };

        case 'RESET':
            return INITIAL_FLOW_STATE;

        default:
            return state;
    }
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

const useCompletionUi = create<{ state: FlowState; dispatch: (action: FlowAction) => void }>((set) => ({
    state: INITIAL_FLOW_STATE,
    dispatch: (action) => set((previous) => ({ state: flowReducer(previous.state, action) })),
}));

export const useRoastCompletionFlow = (): UseRoastCompletionFlowReturn => {
    const { state, dispatch } = useCompletionUi();

    const openEndRoast = useCallback(() => dispatch({ type: 'OPEN_END_ROAST' }), [dispatch]);
    const confirmEndRoast = useCallback(
        (summaryData: RoastSummaryData) => dispatch({ type: 'CONFIRM_END_ROAST', payload: summaryData }),
        [dispatch],
    );
    const closeEndRoast = useCallback(() => dispatch({ type: 'CLOSE_END_ROAST' }), [dispatch]);
    const closeSummary = useCallback(() => dispatch({ type: 'CLOSE_SUMMARY' }), [dispatch]);
    const reopenSummary = useCallback(() => dispatch({ type: 'REOPEN_SUMMARY' }), [dispatch]);
    const discardSummary = useCallback(() => dispatch({ type: 'DISCARD_SUMMARY' }), [dispatch]);
    const onSaveSuccess = useCallback(
        (result: SaveFlowResult) => dispatch({ type: 'SAVE_SUCCESS', payload: result }),
        [dispatch],
    );
    const dismissContinue = useCallback(() => dispatch({ type: 'DISMISS_CONTINUE' }), [dispatch]);
    const resetFlow = useCallback(() => dispatch({ type: 'RESET' }), [dispatch]);

    return {
        ...state,
        openEndRoast,
        confirmEndRoast,
        closeEndRoast,
        closeSummary,
        reopenSummary,
        discardSummary,
        onSaveSuccess,
        dismissContinue,
        resetFlow,
    };
};
