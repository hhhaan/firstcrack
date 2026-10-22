import type { PidRuntime } from '@entities/machine';
import type { sidecar } from '@shared/lib/sidecar';
import type { ReplayPoint } from '../lib/replay';
import type { MachineControlCompositionInput } from './useMachineControlComposition';

export const replayPoints: ReplayPoint[] = [
    { t: 0, bt: 180, heaterSet: 60 },
    { t: 60, bt: 95, heaterSet: 60 },
    { t: 120, bt: 110, heaterSet: 40 },
];

export const pidRuntime = (state: PidRuntime['state']): PidRuntime => ({
    state,
    sv: 200,
    duty: 40,
    pv: 180,
    p: 0,
    i: 0,
    d: 0,
    error: null,
});

export const writableHeaterStatus = {
    connected: true,
    heater_control: { connection_epoch: 7, generation: 0, origin: 'manual', pending_writes: 0, uncertain: false },
    roaster: 'giesen_w6a',
    display_name: 'Giesen',
    brand: 'Giesen',
    capabilities: [],
    uptime: 0,
    error: null,
    control: {
        writable: true,
        limits: { heater: { min: 0, max: 100, unit: '%' } },
        pid: { supported: true, sv_min: 50, sv_max: 250 },
    },
} satisfies Awaited<ReturnType<typeof sidecar.getStatus>>;

export const applyControl = async (cmd: Parameters<typeof sidecar.setControl>[0]) =>
    ({ applied: cmd }) as Awaited<ReturnType<typeof sidecar.setControl>>;

export const offPidResponse = { ok: true, pid: pidRuntime('off') } as Awaited<ReturnType<typeof sidecar.pidOff>>;

export const baseMachineControlInput = (): MachineControlCompositionInput => ({
    sidecarConnected: true,
    reconnecting: false,
    liveData: { heater: 40, fan: 0, drum: 0 },
    pidRuntime: null,
    roastFinished: false,
    pidDropBehavior: 'hold',
    replayPoints,
    replayMachineMismatch: false,
    replayDropTime: null,
    liveBt: 180,
    elapsed: 30,
    roasting: true,
    confirmedTurningPoint: null,
    observationQuality: 'valid',
});
