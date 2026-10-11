import type { CompletedRoastRestore } from '@features/active-roast/model/batch';
import type { ReplayEvent } from '@features/machine-control/lib/replay';
import { describe, expect, it, vi } from 'vitest';
import { runCancelDropMachineWiring } from './active-roast-summary-wiring';

/** Same machine-control leg as ActiveRoast `handleCancelDrop` after `cancelDrop` succeeds. */
const runLikeActiveRoastCancelDrop = (
    restore: CompletedRoastRestore,
    machineControl: {
        replay: { restore: (active: boolean, batchEvents?: ReplayEvent[] | null) => void };
        pid: { turnOff: (mode: 'hold' | 'zero') => Promise<boolean> };
    },
    pidDropBehavior: 'hold' | 'zero',
) =>
    runCancelDropMachineWiring({
        restore,
        replayRestore: (active, batchEvents) =>
            machineControl.replay.restore(active, batchEvents as ReplayEvent[] | null),
        pidTurnOff: (mode) => void machineControl.pid.turnOff(mode),
        pidDropBehavior,
    });

describe('ActiveRoast cancel Drop machine effects (behavioral)', () => {
    it('W1: calls pid.turnOff when PID was engaged at Drop', async () => {
        const pidTurnOff = vi.fn().mockResolvedValue(true);
        const restore = {
            sessionId: 's-a',
            replayActive: false,
            replayBatchEvents: null,
            controlBeforeDrop: { pidEngaged: true, pidSv: 205, heater: 60 },
        } as CompletedRoastRestore;
        runLikeActiveRoastCancelDrop(restore, { replay: { restore: vi.fn() }, pid: { turnOff: pidTurnOff } }, 'zero');
        expect(pidTurnOff).toHaveBeenCalledTimes(1);
        expect(pidTurnOff).toHaveBeenCalledWith('zero');
    });

    it('W2: passes replayBatchEvents through to replay.restore', () => {
        const batchEvents = [{ id: 'edit-1', t: 0, bt: 180, heater: 72, trigger: 'time' as const }];
        const replayRestore = vi.fn();
        const restore = {
            sessionId: 's-a',
            replayActive: true,
            replayBatchEvents: batchEvents,
            controlBeforeDrop: { pidEngaged: false, pidSv: null, heater: 40 },
        } as CompletedRoastRestore;
        runLikeActiveRoastCancelDrop(
            restore,
            { replay: { restore: replayRestore }, pid: { turnOff: vi.fn().mockResolvedValue(true) } },
            'hold',
        );
        expect(replayRestore).toHaveBeenCalledTimes(1);
        expect(replayRestore).toHaveBeenCalledWith(true, batchEvents);
    });
});
