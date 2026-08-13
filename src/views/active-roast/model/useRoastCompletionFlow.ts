import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useReducer } from 'react';

export interface RoastSummaryData {
    totalTime: string;
    development: string;
    finalBt: string;
    logEntries: LogEntry[];
}

export interface SaveFlowResult {
    shouldOpenContinue: boolean;
    continueCandidates?: PlanBatchHandoff[];
}

interface FlowState {
    endRoastModal: boolean;
    summaryModal: boolean;
    summaryData: RoastSummaryData | null;
    continueModal: boolean;
    continueCandidates: PlanBatchHandoff[];
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

/** Overlay / outside-click closer. Must not wipe summaryData (#167 P0.1). */
export const closeSummaryAction = (): FlowAction => ({ type: 'CLOSE_SUMMARY' });

/** Explicit discard. Wipes summaryData and ends the save flow. */
export const discardSummaryAction = (): FlowAction => ({ type: 'DISCARD_SUMMARY' });

/** End Roast stays available after overlay close so the user can re-enter Save. */
export const isEndRoastDisabled = ({
    charged,
    roastEnded,
    hasSummaryData,
}: {
    charged: boolean;
    roastEnded: boolean;
    hasSummaryData: boolean;
}): boolean => {
    if (!charged) return true;
    if (roastEnded) return !hasSummaryData;
    return false;
};

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
    const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW_STATE);

    const openEndRoast = useCallback(() => dispatch({ type: 'OPEN_END_ROAST' }), []);
    const confirmEndRoast = useCallback(
        (summaryData: RoastSummaryData) => dispatch({ type: 'CONFIRM_END_ROAST', payload: summaryData }),
        [],
    );
    const closeEndRoast = useCallback(() => dispatch({ type: 'CLOSE_END_ROAST' }), []);
    const closeSummary = useCallback(() => dispatch(closeSummaryAction()), []);
    const reopenSummary = useCallback(() => dispatch({ type: 'REOPEN_SUMMARY' }), []);
    const discardSummary = useCallback(() => dispatch(discardSummaryAction()), []);
    const onSaveSuccess = useCallback(
        (result: SaveFlowResult) => dispatch({ type: 'SAVE_SUCCESS', payload: result }),
        [],
    );
    const dismissContinue = useCallback(() => dispatch({ type: 'DISMISS_CONTINUE' }), []);
    const resetFlow = useCallback(() => dispatch({ type: 'RESET' }), []);

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
