import { create } from 'zustand';

interface ModalStackState {
    openCount: number;
    register: () => void;
    unregister: () => void;
}

export const useModalStackStore = create<ModalStackState>((set) => ({
    openCount: 0,
    register: () => set((state) => ({ openCount: state.openCount + 1 })),
    unregister: () => set((state) => ({ openCount: Math.max(0, state.openCount - 1) })),
}));

export const selectIsAnyModalOpen = (state: ModalStackState) => state.openCount > 0;
