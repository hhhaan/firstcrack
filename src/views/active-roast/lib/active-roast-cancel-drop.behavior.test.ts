import type { CompletedRoastRestore } from '@features/active-roast/model/batch';
import { describe, expect, it, vi } from 'vitest';
import {
    type CancelDropMachineControl,
    createCancelDropMachineDeps,
    runCancelDropMachineEffects,
} from './active-roast-cancel-drop-wiring';

const machineControl = (overrides?: {
    replayRestore?: ReturnType<typeof vi.fn>;
    pidTurnOff?: ReturnType<typeof vi.fn>;
}): CancelDropMachineControl => ({
    replay: {
        restore: (overrides?.replayRestore ?? vi.fn()) as CancelDropMachineControl['replay']['restore'],
    },
    pid: {
        turnOff: (overrides?.pidTurnOff ??
            vi.fn().mockResolvedValue(true)) as CancelDropMachineControl['pid']['turnOff'],
    },
});

describe('createCancelDropMachineDeps (ActiveRoast cancel Drop wiring)', () => {
    it('W1: pidTurnOff delegates to machineControl.pid.turnOff', () => {
        const pidTurnOff = vi.fn().mockResolvedValue(true);
        const deps = createCancelDropMachineDeps(machineControl({ pidTurnOff }), 'zero');
        deps.pidTurnOff('zero');
        expect(pidTurnOff).toHaveBeenCalledTimes(1);
        expect(pidTurnOff).toHaveBeenCalledWith('zero');
    });

    it('W2: replayRestore forwards batchEvents to machineControl.replay.restore', () => {
        const replayRestore = vi.fn();
        const batchEvents = [{ id: 'edit-1', t: 0, bt: 180, heater: 72, trigger: 'time' as const }];
        const deps = createCancelDropMachineDeps(machineControl({ replayRestore }), 'hold');
        deps.replayRestore(true, batchEvents);
        expect(replayRestore).toHaveBeenCalledTimes(1);
        expect(replayRestore).toHaveBeenCalledWith(true, batchEvents);
    });
});

describe('runCancelDropMachineEffects', () => {
    it('runs full cancel path with PID off and replay batch events', () => {
        const pidTurnOff = vi.fn().mockResolvedValue(true);
        const replayRestore = vi.fn();
        const batchEvents = [{ id: 'edit-1', t: 0, bt: 180, heater: 72, trigger: 'time' as const }];
        const restore = {
            sessionId: 's-a',
            replayActive: true,
            replayBatchEvents: batchEvents,
            controlBeforeDrop: { pidEngaged: true, pidSv: 205, heater: 60 },
        } as CompletedRoastRestore;
        runCancelDropMachineEffects(restore, machineControl({ pidTurnOff, replayRestore }), 'zero');
        expect(pidTurnOff).toHaveBeenCalledWith('zero');
        expect(replayRestore).toHaveBeenCalledWith(true, batchEvents);
    });
});
