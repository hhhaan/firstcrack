import { create } from 'zustand';

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
    isRoasting: boolean;
    charged: boolean;
    elapsed: number;
    sidecarConnected: boolean;
    machineCapabilities: string[];
    liveData: LiveData | null;

    startCharge: () => void;
    endRoast: () => void;
    tick: () => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    updateLiveData: (data: LiveData) => void;
    reset: () => void;
}

const initialState = {
    isRoasting: false,
    charged: false,
    elapsed: 0,
    sidecarConnected: false,
    machineCapabilities: [] as string[],
    liveData: null as LiveData | null,
};

const useRoastingStore = create<RoastingState>((set, get) => ({
    ...initialState,

    startCharge: () => {
        set({ charged: true, isRoasting: true });
    },

    endRoast: () => {
        set({ isRoasting: false });
    },

    tick: () => {
        set((state) => state.isRoasting ? { elapsed: state.elapsed + 1 } : state);
    },

    setConnected: (connected: boolean, capabilities?: string[]) => {
        set({
            sidecarConnected: connected,
            ...(capabilities && { machineCapabilities: capabilities }),
        });
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
        ) return;
        set({ liveData: data });
    },

    reset: () => {
        set(initialState);
    },
}));

export default useRoastingStore;
