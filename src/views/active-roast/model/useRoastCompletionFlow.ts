import type { RoastSummaryData } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { useCallback, useReducer } from 'react';

export type { RoastSummaryData } from '@features/active-roast/model/batch';

export interface SaveFlowResult {
    shouldOpenContinue: boolean;
    continueCandidates?: PlanBatchWithProgress[];
}
interface FlowState {
    endRoastModal: boolean;
    summaryModal: boolean;
    summarySessionId: string | null;
    continueModal: boolean;
    continueCandidates: PlanBatchWithProgress[];
}
const INITIAL_FLOW_STATE: FlowState = {
    endRoastModal: false,
    summaryModal: false,
    summarySessionId: null,
    continueModal: false,
    continueCandidates: [],
};
type FlowAction =
    | { type: 'OPEN_END_ROAST' }
    | { type: 'CONFIRM_END_ROAST'; sessionId: string | null }
    | { type: 'CLOSE_END_ROAST' }
    | { type: 'CLOSE_SUMMARY' }
    | { type: 'REOPEN_SUMMARY'; sessionId: string }
    | { type: 'DISCARD_SUMMARY' }
    | { type: 'SAVE_SUCCESS'; payload: SaveFlowResult }
    | { type: 'DISMISS_CONTINUE' }
    | { type: 'RESET' };
/** Only view state lives here; completed data belongs to the batch model. */
export function flowReducer(state: FlowState, action: FlowAction): FlowState {
    switch (action.type) {
        case 'OPEN_END_ROAST':
            return { ...state, endRoastModal: true };
        case 'CONFIRM_END_ROAST':
            return { ...state, endRoastModal: false, summaryModal: true, summarySessionId: action.sessionId };
        case 'CLOSE_END_ROAST':
            return { ...state, endRoastModal: false };
        case 'CLOSE_SUMMARY':
            return { ...state, summaryModal: false };
        case 'REOPEN_SUMMARY':
            return { ...state, summaryModal: true, summarySessionId: action.sessionId };
        case 'DISCARD_SUMMARY':
        case 'RESET':
            return INITIAL_FLOW_STATE;
        case 'SAVE_SUCCESS':
            return {
                ...state,
                summaryModal: false,
                summarySessionId: null,
                continueModal: action.payload.shouldOpenContinue,
                continueCandidates: action.payload.shouldOpenContinue ? (action.payload.continueCandidates ?? []) : [],
            };
        case 'DISMISS_CONTINUE':
            return { ...state, continueModal: false, continueCandidates: [] };
        default:
            return state;
    }
}
export const useRoastCompletionFlow = () => {
    const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW_STATE);
    const summaryData = useRoastingStore((store) => store.completed?.summary ?? null);
    const openEndRoast = useCallback(() => dispatch({ type: 'OPEN_END_ROAST' }), []);
    const confirmEndRoast = useCallback((summary: RoastSummaryData) => {
        dispatch({ type: 'CONFIRM_END_ROAST', sessionId: summary.sessionId ?? null });
    }, []);
    const closeEndRoast = useCallback(() => dispatch({ type: 'CLOSE_END_ROAST' }), []);
    const closeSummary = useCallback(() => dispatch({ type: 'CLOSE_SUMMARY' }), []);
    const reopenSummary = useCallback(() => {
        const summary = useRoastingStore.getState().completed?.summary;
        if (summary?.sessionId) dispatch({ type: 'REOPEN_SUMMARY', sessionId: summary.sessionId });
    }, []);
    const discardSummary = useCallback((ownerId: string | null, sessionId: string | null) => {
        if (!useRoastingStore.getState().discardSummary(ownerId, sessionId)) return;
        dispatch({ type: 'DISCARD_SUMMARY' });
    }, []);
    const onSaveSuccess = useCallback((result: SaveFlowResult & { ownerId: string; sessionId: string | null }) => {
        if (!useRoastingStore.getState().saveSucceeded(result.ownerId, result.sessionId)) return false;
        dispatch({ type: 'SAVE_SUCCESS', payload: result });
        return true;
    }, []);
    const dismissContinue = useCallback(() => dispatch({ type: 'DISMISS_CONTINUE' }), []);
    const resetFlow = useCallback(() => dispatch({ type: 'RESET' }), []);
    return {
        ...state,
        summaryData,
        summaryModal: state.summaryModal && state.summarySessionId === summaryData?.sessionId,
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
export type UseRoastCompletionFlowReturn = ReturnType<typeof useRoastCompletionFlow>;
