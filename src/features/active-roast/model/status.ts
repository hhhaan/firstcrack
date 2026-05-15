import { create } from 'zustand';

export type RoastPhase = 'idle' | 'preheating' | 'standby' | 'roasting' | 'ended';

type LiveData = {
    bt: number | null;
    et: number | null;
    ror: number;
    ror_et: number;
    heater: number;
    fan: number;
    drum: number;
};

export interface RoastingState {
    phase: RoastPhase;
    elapsed: number;
    sidecarConnected: boolean;
    machineCapabilities: string[];
    liveData: LiveData | null;
    pendingBeanId: string | null;

    // derived convenience
    isRoasting: boolean;
    charged: boolean;

    enterPreheating: (capabilities?: string[]) => void;
    enterStandby: () => void;
    startCharge: () => void;
    endRoast: () => void;
    tick: () => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    updateLiveData: (data: LiveData) => void;
    setPendingBean: (beanId: string | null) => void;
    reset: () => void;
}

const initialState = {
    phase: 'idle' as RoastPhase,
    elapsed: 0,
    sidecarConnected: false,
    machineCapabilities: [] as string[],
    liveData: null as LiveData | null,
    pendingBeanId: null as string | null,
    isRoasting: false,
    charged: false,
};

export const useRoastingStore = create<RoastingState>((set, get) => ({
    ...initialState,

    enterPreheating: (capabilities?: string[]) => {
        set({
            phase: 'preheating',
            sidecarConnected: true,
            ...(capabilities && { machineCapabilities: capabilities }),
        });
    },

    enterStandby: () => {
        const { phase } = get();
        if (phase !== 'preheating') return;
        set({ phase: 'standby' });
    },

    startCharge: () => {
        set({ phase: 'roasting', charged: true, isRoasting: true });
    },

    endRoast: () => {
        set({ phase: 'ended', isRoasting: false });
    },

    tick: () => {
        set((state) => (state.isRoasting ? { elapsed: state.elapsed + 1 } : state));
    },

    setConnected: (connected: boolean, capabilities?: string[]) => {
        set({
            sidecarConnected: connected,
            ...(capabilities && { machineCapabilities: capabilities }),
            ...(!connected && { phase: get().phase === 'idle' ? 'idle' : get().phase }),
        });
    },

    setPendingBean: (beanId) => {
        set({ pendingBeanId: beanId });
    },

    updateLiveData: (data) => {
        const current = get().liveData;
        if (
            current &&
            current.bt === data.bt &&
            current.et === data.et &&
            current.ror === data.ror &&
            current.ror_et === data.ror_et &&
            current.heater === data.heater &&
            current.fan === data.fan &&
            current.drum === data.drum
        )
            return;
        set({ liveData: data });
    },

    reset: () => {
        const { sidecarConnected, machineCapabilities } = get();
        set({ ...initialState, sidecarConnected, machineCapabilities });
    },
}));
