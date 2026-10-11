import type { CompletedRoastRestore, DropControlSnapshot } from '@features/active-roast/model/batch';
import type { ReplayEvent } from '@features/machine-control/lib/replay';
import { type RunCancelDropMachineWiringInput, runCancelDropMachineWiring } from './active-roast-summary-wiring';

export type CancelDropMachineControl = {
    replay: { restore: (active: boolean, batchEvents?: ReplayEvent[] | null) => void };
    pid: { turnOff: (mode: 'hold' | 'zero') => Promise<unknown> };
};

/** Lambdas ActiveRoast passes into `runCancelDropMachineWiring` — single source for tests and view. */
export const createCancelDropMachineDeps = (
    machineControl: CancelDropMachineControl,
    pidDropBehavior: 'hold' | 'zero',
): Omit<RunCancelDropMachineWiringInput, 'restore'> => ({
    replayRestore: (active, batchEvents) => machineControl.replay.restore(active, batchEvents as ReplayEvent[] | null),
    pidTurnOff: (mode) => void machineControl.pid.turnOff(mode),
    pidDropBehavior,
});

export const runCancelDropMachineEffects = (
    restore: CompletedRoastRestore,
    machineControl: CancelDropMachineControl,
    pidDropBehavior: 'hold' | 'zero',
): DropControlSnapshot | null =>
    runCancelDropMachineWiring({
        restore,
        ...createCancelDropMachineDeps(machineControl, pidDropBehavior),
    });
