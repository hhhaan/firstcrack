import type { LogEntry } from '@shared/types/roast';
import { useCallback, useReducer } from 'react';

export interface RoastSummaryData {
    totalTime: string;
    development: string;
    finalBt: string;
    logEntries: LogEntry[];
}

export interface PendingStockDeduct {
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    referenceId: string;
    beanName: string | null;
}

export interface SaveFlowResult {
    deductionPlan: PendingStockDeduct | null;
    shouldOpenContinue: boolean;
}

interface FlowState {
    endRoastModal: boolean;
    summaryModal: boolean;
    summaryData: RoastSummaryData | null;
    deductModal: boolean;
    continueModal: boolean;
    continueAfterDeduct: boolean;
    pendingStockDeduct: PendingStockDeduct | null;
}

const INITIAL_FLOW_STATE: FlowState = {
    endRoastModal: false,
    summaryModal: false,
    summaryData: null,
    deductModal: false,
    continueModal: false,
    continueAfterDeduct: false,
    pendingStockDeduct: null,
};

type FlowAction =
    | { type: 'OPEN_END_ROAST' }
    | { type: 'CONFIRM_END_ROAST'; payload: RoastSummaryData }
    | { type: 'CLOSE_END_ROAST' }
    | { type: 'CLOSE_SUMMARY' }
    | { type: 'DISCARD_SUMMARY' }
    | { type: 'SAVE_SUCCESS'; payload: SaveFlowResult }
    | { type: 'FINISH_DEDUCT_FLOW' }
    | { type: 'DISMISS_CONTINUE' }
    | { type: 'RESET' };

function flowReducer(state: FlowState, action: FlowAction): FlowState {
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

        case 'CLOSE_SUMMARY':
            return { ...state, summaryModal: false, summaryData: null };

        case 'DISCARD_SUMMARY':
            return {
                ...INITIAL_FLOW_STATE,
            };

        case 'SAVE_SUCCESS': {
            const { deductionPlan, shouldOpenContinue } = action.payload;
            if (deductionPlan) {
                return {
                    ...state,
                    summaryModal: false,
                    summaryData: null,
                    deductModal: true,
                    continueAfterDeduct: shouldOpenContinue,
                    pendingStockDeduct: deductionPlan,
                };
            }
            if (shouldOpenContinue) {
                return {
                    ...state,
                    summaryModal: false,
                    summaryData: null,
                    continueModal: true,
                };
            }
            return {
                ...state,
                summaryModal: false,
                summaryData: null,
            };
        }

        case 'FINISH_DEDUCT_FLOW':
            return {
                ...state,
                deductModal: false,
                pendingStockDeduct: null,
                continueModal: state.continueAfterDeduct,
                continueAfterDeduct: false,
            };

        case 'DISMISS_CONTINUE':
            return { ...state, continueModal: false };

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
    discardSummary: () => void;
    onSaveSuccess: (result: SaveFlowResult) => void;
    finishDeductFlow: () => void;
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
    const closeSummary = useCallback(() => dispatch({ type: 'CLOSE_SUMMARY' }), []);
    const discardSummary = useCallback(() => dispatch({ type: 'DISCARD_SUMMARY' }), []);
    const onSaveSuccess = useCallback(
        (result: SaveFlowResult) => dispatch({ type: 'SAVE_SUCCESS', payload: result }),
        [],
    );
    const finishDeductFlow = useCallback(() => dispatch({ type: 'FINISH_DEDUCT_FLOW' }), []);
    const dismissContinue = useCallback(() => dispatch({ type: 'DISMISS_CONTINUE' }), []);
    const resetFlow = useCallback(() => dispatch({ type: 'RESET' }), []);

    return {
        ...state,
        openEndRoast,
        confirmEndRoast,
        closeEndRoast,
        closeSummary,
        discardSummary,
        onSaveSuccess,
        finishDeductFlow,
        dismissContinue,
        resetFlow,
    };
};
