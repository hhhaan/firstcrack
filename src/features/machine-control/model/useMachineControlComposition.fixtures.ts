import type { PidRuntime } from '@entities/machine';
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
