import { create } from 'zustand';
import type { PlanBatchHandoff } from '../types/database.types';

interface RoastSessionState {
    planBatchHandoff: PlanBatchHandoff | null;
}

interface RoastSessionActions {
    startBatch: (handoff: PlanBatchHandoff) => void;
    completeBatch: () => void;
}

export const useRoastSessionStore = create<RoastSessionState & RoastSessionActions>((set) => ({
    planBatchHandoff: null,

    startBatch: (handoff) => set({ planBatchHandoff: handoff }),

    completeBatch: () => set({ planBatchHandoff: null }),
}));
