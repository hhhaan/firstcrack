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
    /** Whole seconds since charge; wall-clock from roastStartMs (not a +1 counter). */
    elapsed: number;
    /** Charge origin (ms since epoch). 0 = not charged. Shared with livePoints.time. */
    roastStartMs: number;
    sidecarConnected: boolean;
    sidecarError: string | null;
    machineCapabilities: string[];
    liveData: LiveData | null;
    /** Inventory/other entry → active roast bean handoff (consumed once when roast view activates). */
    pendingBeanId: string | null;
    pendingBeanName: string | null;
    sessionId: string | null;
    reconnecting: boolean;

    // derived convenience
    isRoasting: boolean;
    charged: boolean;

    enterPreheating: (capabilities?: string[]) => void;
    enterStandby: () => void;
    /** originMs: charge wall time (auto-charge onset). Defaults to Date.now(). */
    startCharge: (originMs?: number) => void;
    endRoast: () => void;
    tick: () => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    setError: (error: string | null) => void;
    setReconnecting: (reconnecting: boolean) => void;
    updateLiveData: (data: LiveData) => void;
    setPendingBean: (beanId: string | null, beanName?: string | null) => void;
    reset: () => void;
}

const initialState = {
    phase: 'idle' as RoastPhase,
    elapsed: 0,
    roastStartMs: 0,
    sidecarConnected: false,
    sidecarError: null as string | null,
    machineCapabilities: [] as string[],
    liveData: null as LiveData | null,
    pendingBeanId: null as string | null,
    pendingBeanName: null as string | null,
    sessionId: null as string | null,
    reconnecting: false,
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

    startCharge: (originMs?: number) => {
        const now = Date.now();
        const origin = originMs != null && originMs > 0 && originMs <= now ? originMs : now;
        set({
            phase: 'roasting',
            charged: true,
            isRoasting: true,
            sessionId: crypto.randomUUID(),
            roastStartMs: origin,
            elapsed: Math.floor((now - origin) / 1000),
        });
    },

    endRoast: () => {
        set({ phase: 'ended', isRoasting: false, roastStartMs: 0 });
    },

    tick: () => {
        const { isRoasting, roastStartMs } = get();
        if (!isRoasting || roastStartMs <= 0) return;
        set({ elapsed: Math.floor((Date.now() - roastStartMs) / 1000) });
    },

    setConnected: (connected: boolean, capabilities?: string[]) => {
        set({
            sidecarConnected: connected,
            ...(connected && { sidecarError: null }),
            ...(capabilities && { machineCapabilities: capabilities }),
            ...(!connected && { phase: get().phase === 'idle' ? 'idle' : get().phase }),
        });
    },

    setError: (error) => set({ sidecarError: error }),

    setReconnecting: (reconnecting) => set({ reconnecting }),

    setPendingBean: (beanId, beanName = null) => {
        set({ pendingBeanId: beanId, pendingBeanName: beanId ? (beanName ?? null) : null });
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
