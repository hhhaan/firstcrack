import type { MachineSnapshot, PidRuntime } from '@entities/machine';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import type { TemperatureProcessing } from '@shared/types/sidecar';
import type { SetStateAction } from 'react';
import { create } from 'zustand';
import type { RawTemperatureSample } from '../lib/autoCharge';
import type { SensorObservation } from '../lib/sensorObservation';
import { type CompletedSlice, createCompletedSlice } from './completed';

export type RoastPhase = 'idle' | 'preheating' | 'standby' | 'roasting' | 'ended';

/** idle / preheating / standby are not charged. roasting and ended stay charged until reset. */
export const isChargedPhase = (phase: RoastPhase): boolean => phase === 'roasting' || phase === 'ended';

type LiveData = {
    bt: number | null;
    bt_raw?: number | null;
    timestamp?: number;
    sensor_clock?: string;
    processing?: TemperatureProcessing;
    receivedAtMs?: number;
    stale?: boolean;
    et: number | null;
    /** Unsmoothed sensor ET. Archive only; display stays on `et`. */
    et_raw?: number | null;
    ror: number;
    ror_et: number;
    /** null = 이 머신에 화력 피드백 채널이 없다 */
    heater: number | null;
    fan: number;
    drum: number;
};

export interface BatchSelection {
    selectedBeanId: string | null;
    targetProfileId: string | null;
    handoffBeanName: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
}

export interface RoastingState extends CompletedSlice {
    logEntries: LogEntry[];
    fcDualUnwind: boolean;
    livePoints: LiveRoastPoint[];
    prepared: BatchSelection;
    currentBatch: BatchSelection | null;
    initializedTsvSessions: Set<string>;
    setLogEntries: (entries: SetStateAction<LogEntry[]>) => void;
    setLogState: (
        update: (prev: { entries: LogEntry[]; unwind: boolean }) => { entries: LogEntry[]; unwind: boolean },
    ) => void;
    setLivePoints: (points: SetStateAction<LiveRoastPoint[]>) => void;
    prepareBatch: (patch: Partial<BatchSelection>) => void;
    claimSessionTsv: (sessionId: string) => boolean;
    phase: RoastPhase;
    /** Whole seconds since charge; wall-clock from roastStartMs (not a +1 counter). */
    elapsed: number;
    /** Charge origin (ms since epoch). 0 = not charged. Shared with livePoints.time. */
    roastStartMs: number;
    sidecarConnected: boolean;
    sidecarError: string | null;
    machineCapabilities: string[];
    liveData: LiveData | null;
    rawTemperature: RawTemperatureSample | null;
    updateRawTemperature: (sample: RawTemperatureSample | null) => void;
    /** Control-path quality/freshness. Display consumers should keep selecting `liveData`. */
    observation: SensorObservation | null;
    updateSensorObservation: (observation: SensorObservation | null) => void;
    /** 사이드카 PID 런타임 상태 (/temperatures에 실려 온다). PID 미사용이면 null. */
    pid: PidRuntime | null;
    /** Inventory/other entry → active roast bean handoff (consumed once when roast view activates). */
    pendingBeanId: string | null;
    pendingBeanName: string | null;
    /** Profiles page "start with this profile" → target profile handoff (consumed once). */
    pendingProfileId: string | null;
    sessionId: string | null;
    /** Workspace owner at charge. Survives endRoast; cleared on reset with sessionId. */
    sessionOwnerId: string | null;
    reconnecting: boolean;
    /** Last connected machine this roast; kept through disconnect until reset. */
    machineSnapshot: MachineSnapshot | null;
    /** After Drop/abort: next Charge is allowed even before the prior batch is saved. */
    awaitingNextCharge: boolean;
    /**
     * Drop/abort stopped PID/Replay. Stays set through Drop cancel so cancel cannot
     * auto-resume machine output. Cleared only on the next Charge / full reset.
     */
    heatHoldAfterDrop: boolean;

    enterPreheating: (capabilities?: string[]) => void;
    enterStandby: () => void;
    /** originMs: charge wall time (auto-charge onset). Defaults to Date.now(). */
    startCharge: (originMs?: number, ownerId?: string) => void;
    endRoast: () => void;
    tick: () => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    setError: (error: string | null) => void;
    setReconnecting: (reconnecting: boolean) => void;
    updateLiveData: (data: LiveData) => void;
    setPid: (pid: PidRuntime | null) => void;
    setPendingBean: (beanId: string | null, beanName?: string | null) => void;
    setPendingProfile: (profileId: string | null) => void;
    rememberMachineSnapshot: (snapshot: MachineSnapshot) => void;
    reset: () => void;
}

const emptySelection: BatchSelection = {
    selectedBeanId: null,
    targetProfileId: null,
    handoffBeanName: null,
    planBatchHandoff: null,
};

const initialState = {
    logEntries: [] as LogEntry[],
    fcDualUnwind: false,
    livePoints: [] as LiveRoastPoint[],
    prepared: emptySelection,
    currentBatch: null as BatchSelection | null,
    initializedTsvSessions: new Set<string>(),
    phase: 'idle' as RoastPhase,
    elapsed: 0,
    roastStartMs: 0,
    sidecarConnected: false,
    sidecarError: null as string | null,
    machineCapabilities: [] as string[],
    liveData: null as LiveData | null,
    rawTemperature: null as RawTemperatureSample | null,
    observation: null as SensorObservation | null,
    pid: null as PidRuntime | null,
    pendingBeanId: null as string | null,
    pendingBeanName: null as string | null,
    pendingProfileId: null as string | null,
    sessionId: null as string | null,
    sessionOwnerId: null as string | null,
    reconnecting: false,
    machineSnapshot: null as MachineSnapshot | null,
    awaitingNextCharge: false,
    heatHoldAfterDrop: false,
};

export const useRoastingStore = create<RoastingState>((set, get) => ({
    ...initialState,
    ...createCompletedSlice(set, get),

    setLogEntries: (action) =>
        set((state) => ({ logEntries: typeof action === 'function' ? action(state.logEntries) : action })),
    setLogState: (update) =>
        set((state) => {
            const next = update({ entries: state.logEntries, unwind: state.fcDualUnwind });
            return { logEntries: next.entries, fcDualUnwind: next.unwind };
        }),
    setLivePoints: (action) =>
        set((state) => ({ livePoints: typeof action === 'function' ? action(state.livePoints) : action })),
    prepareBatch: (patch) => set((state) => ({ prepared: { ...state.prepared, ...patch } })),
    claimSessionTsv: (sessionId) => {
        if (get().initializedTsvSessions.has(sessionId)) return false;
        set({ initializedTsvSessions: new Set(get().initializedTsvSessions).add(sessionId) });
        return true;
    },

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

    startCharge: (originMs?: number, ownerId?: string) => {
        if (isChargedPhase(get().phase)) return; // sessionId 재생성 방지 — 심층 방어 (#174)
        const now = Date.now();
        const origin =
            originMs != null && Number.isFinite(originMs) && originMs > 0 && originMs <= now ? originMs : now;
        set({
            phase: 'roasting',
            currentBatch: { ...get().prepared, planBatchHandoff: useRoastSessionStore.getState().planBatchHandoff },
            prepared: { ...get().prepared, planBatchHandoff: null },
            logEntries: [],
            fcDualUnwind: false,
            sessionId: crypto.randomUUID(),
            sessionOwnerId: ownerId || null,
            roastStartMs: origin,
            elapsed: Math.floor((now - origin) / 1000),
            awaitingNextCharge: false,
            heatHoldAfterDrop: false,
        });
        useRoastSessionStore.getState().completeBatch();
        get().lockAfterCharge(get().sessionId);
    },

    endRoast: () => {
        set({ phase: 'ended', roastStartMs: 0 });
    },

    tick: () => {
        const { phase, roastStartMs } = get();
        if (phase !== 'roasting' || roastStartMs <= 0) return;
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

    setPendingProfile: (profileId) => set({ pendingProfileId: profileId }),

    rememberMachineSnapshot: (snapshot) => {
        const current = get().machineSnapshot;
        if (
            current?.machine_id === snapshot.machine_id &&
            current?.machine_name === snapshot.machine_name &&
            current?.machine_roaster_key === snapshot.machine_roaster_key &&
            current?.machine_brand === snapshot.machine_brand &&
            current?.machine_protocol === snapshot.machine_protocol
        )
            return;
        set({ machineSnapshot: snapshot, rawTemperature: null, observation: null });
    },

    updateRawTemperature: (rawTemperature) => set({ rawTemperature }),

    updateSensorObservation: (observation) => {
        if (get().observation === observation) return;
        set({ observation });
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

    setPid: (pid) => {
        const current = get().pid;
        // 폴링마다 새 객체가 오므로 값이 같으면 리렌더를 막는다
        if (
            current?.state === pid?.state &&
            current?.sv === pid?.sv &&
            current?.duty === pid?.duty &&
            current?.pv === pid?.pv &&
            current?.p === pid?.p &&
            current?.i === pid?.i &&
            current?.d === pid?.d &&
            current?.error === pid?.error
        )
            return;
        set({ pid });
    },

    reset: () => {
        const { sidecarConnected, machineCapabilities, prepared, initializedTsvSessions } = get();
        set({ ...initialState, sidecarConnected, machineCapabilities, prepared, initializedTsvSessions });
    },
}));
