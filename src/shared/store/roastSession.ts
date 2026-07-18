import { create } from 'zustand';
import type { PlanBatchHandoff } from '../types/database.types';

/** 직전 애드혹(스케줄 미연결) 배치의 저장값 — 다음 배치 저장 폼 프리필용. 세션 한정, non-persist. */
export interface LastAdhocSave {
    beanId: string | null;
    /** kg (폼 관례상 weightGrams 필드에 들어가지만 단위는 kg) */
    weightKg: number;
    roastLevel: string | null;
}

interface RoastSessionState {
    planBatchHandoff: PlanBatchHandoff | null;
    lastAdhocSave: LastAdhocSave | null;
}

interface RoastSessionActions {
    startBatch: (handoff: PlanBatchHandoff) => void;
    completeBatch: () => void;
    recordAdhocSave: (save: LastAdhocSave) => void;
}

export const useRoastSessionStore = create<RoastSessionState & RoastSessionActions>((set) => ({
    planBatchHandoff: null,
    lastAdhocSave: null,

    startBatch: (handoff) => set({ planBatchHandoff: handoff }),

    completeBatch: () => set({ planBatchHandoff: null }),

    recordAdhocSave: (save) => set({ lastAdhocSave: save }),
}));
