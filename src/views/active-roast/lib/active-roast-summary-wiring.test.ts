import type { CompletedRoastRestore } from '@features/active-roast/model/batch';
import { describe, expect, it, vi } from 'vitest';
import {
    cancelDropControlWarningAfterRestore,
    dropCancelBannerAfterSuccessfulCancel,
    hadSummaryBeforeSummaryDiscard,
    invokeSidecarResetAfterSave,
    planSummaryDiscardSidecarReset,
    runCancelDropMachineWiring,
    runSummaryDiscardSidecarReset,
    shouldResetSidecarAfterSave,
} from './active-roast-summary-wiring';

describe('cancelDropControlWarningAfterRestore (M3 wiring)', () => {
    it('sets banner state from restore.controlBeforeDrop', () => {
        const restore = {
            controlBeforeDrop: { pidEngaged: true, pidSv: 205, heater: 60 },
        } as CompletedRoastRestore;
        expect(cancelDropControlWarningAfterRestore(restore)).toEqual({
            pidEngaged: true,
            pidSv: 205,
            heater: 60,
        });
    });
});

describe('planSummaryDiscardSidecarReset (M4 wiring)', () => {
    it('does not reset when batch B is roasting', () => {
        expect(
            planSummaryDiscardSidecarReset({
                sessionId: 's-a',
                hadSummaryBeforeDiscard: true,
                snapshotSessionId: 's-a',
                summaryAfterDiscard: null,
                live: { sessionId: 's-b', phase: 'roasting', awaitingNextCharge: false },
            }),
        ).toBe(false);
    });

    it('does not reset when #752 closed modal without a summary', () => {
        expect(
            planSummaryDiscardSidecarReset({
                sessionId: 's-a',
                hadSummaryBeforeDiscard: false,
                snapshotSessionId: 's-a',
                summaryAfterDiscard: null,
                live: { sessionId: null, phase: 'standby', awaitingNextCharge: true },
            }),
        ).toBe(false);
    });

    it('resets after a real discard on the same batch', () => {
        expect(
            planSummaryDiscardSidecarReset({
                sessionId: 's-a',
                hadSummaryBeforeDiscard: true,
                snapshotSessionId: 's-a',
                summaryAfterDiscard: null,
                live: { sessionId: null, phase: 'standby', awaitingNextCharge: true },
            }),
        ).toBe(true);
    });
});

describe('shouldResetSidecarAfterSave', () => {
    it('allows reset after Drop save while awaiting Charge', () => {
        expect(
            shouldResetSidecarAfterSave({
                sessionId: 's-a',
                live: {
                    sessionId: null,
                    phase: 'standby',
                    awaitingNextCharge: true,
                    pid: { state: 'off', sv: null, duty: null, pv: null, p: 0, i: 0, d: 0, error: null },
                },
            }),
        ).toBe(true);
    });

    it('skips when PID is engaged', () => {
        expect(
            shouldResetSidecarAfterSave({
                sessionId: 's-a',
                live: {
                    sessionId: null,
                    phase: 'standby',
                    awaitingNextCharge: true,
                    pid: { state: 'running', sv: 200, duty: 50, pv: 180, p: 0, i: 0, d: 0, error: null },
                },
            }),
        ).toBe(false);
    });

    it('skips when batch B is roasting (M14)', () => {
        expect(
            shouldResetSidecarAfterSave({
                sessionId: 's-a',
                live: {
                    sessionId: 's-b',
                    phase: 'roasting',
                    awaitingNextCharge: false,
                    pid: { state: 'off', sv: null, duty: null, pv: null, p: 0, i: 0, d: 0, error: null },
                },
            }),
        ).toBe(false);
    });
});

describe('invokeSidecarResetAfterSave (M14 wiring)', () => {
    it('does not reset when another batch owns the machine', () => {
        const reset = vi.fn();
        invokeSidecarResetAfterSave({
            sessionId: 's-a',
            readLive: () => ({
                sessionId: 's-b',
                phase: 'roasting',
                awaitingNextCharge: false,
                pid: { state: 'off', sv: null, duty: null, pv: null, p: 0, i: 0, d: 0, error: null },
            }),
            resetSidecarRoast: reset,
        });
        expect(reset).not.toHaveBeenCalled();
    });

    it('resets after Drop save on the same batch', () => {
        const reset = vi.fn();
        invokeSidecarResetAfterSave({
            sessionId: 's-a',
            readLive: () => ({
                sessionId: null,
                phase: 'standby',
                awaitingNextCharge: true,
                pid: { state: 'off', sv: null, duty: null, pv: null, p: 0, i: 0, d: 0, error: null },
            }),
            resetSidecarRoast: reset,
        });
        expect(reset).toHaveBeenCalledTimes(1);
    });
});

describe('runCancelDropMachineWiring (M3 / cancel PID off)', () => {
    it('restores replay and calls pid turnOff when PID was engaged at Drop', () => {
        const replayRestore = vi.fn();
        const pidTurnOff = vi.fn();
        const restore = {
            sessionId: 's-a',
            replayActive: true,
            replayBatchEvents: [{ id: 'e1', t: 0, bt: 180, heater: 80, trigger: 'time' }],
            controlBeforeDrop: { pidEngaged: true, pidSv: 205, heater: 60 },
        } as import('@features/active-roast/model/batch').CompletedRoastRestore;
        const banner = runCancelDropMachineWiring({
            restore,
            replayRestore,
            pidTurnOff,
            pidDropBehavior: 'zero',
        });
        expect(replayRestore).toHaveBeenCalledWith(true, restore.replayBatchEvents);
        expect(pidTurnOff).toHaveBeenCalledWith('zero');
        expect(banner).toEqual({ pidEngaged: true, pidSv: 205, heater: 60 });
    });

    it('does not call pid turnOff when PID was off at Drop', () => {
        const pidTurnOff = vi.fn();
        const restore = {
            controlBeforeDrop: { pidEngaged: false, pidSv: null, heater: 40 },
        } as import('@features/active-roast/model/batch').CompletedRoastRestore;
        runCancelDropMachineWiring({
            restore,
            replayRestore: vi.fn(),
            pidTurnOff,
            pidDropBehavior: 'hold',
        });
        expect(pidTurnOff).not.toHaveBeenCalled();
    });
});

describe('dropCancelBannerAfterSuccessfulCancel (M3 wiring)', () => {
    it('returns banner state from restore.controlBeforeDrop', () => {
        const restore = {
            sessionId: 's-a',
            controlBeforeDrop: { pidEngaged: true, pidSv: 205, heater: 60 },
        } as CompletedRoastRestore;
        expect(dropCancelBannerAfterSuccessfulCancel(restore)).toEqual({
            pidEngaged: true,
            pidSv: 205,
            heater: 60,
        });
    });

    it('returns null when restore is missing', () => {
        expect(dropCancelBannerAfterSuccessfulCancel(null)).toBeNull();
    });
});

describe('runSummaryDiscardSidecarReset (M4 / M16 wiring)', () => {
    it('does not reset when batch B is roasting', () => {
        const reset = vi.fn();
        runSummaryDiscardSidecarReset({
            sessionId: 's-a',
            completedBeforeDiscard: {
                summary: { sessionId: 's-a' } as import('@features/active-roast/model/batch').RoastSummaryData,
                snapshot: { sessionId: 's-a' },
            },
            discardSummary: () => {},
            readLive: () => ({
                sessionId: 's-b',
                phase: 'roasting',
                awaitingNextCharge: false,
                completed: { summary: null, snapshot: { sessionId: 's-a' } },
            }),
            resetSidecarRoast: reset,
        });
        expect(reset).not.toHaveBeenCalled();
    });

    it('does not reset when store had no summary (#752 / M16)', () => {
        const reset = vi.fn();
        runSummaryDiscardSidecarReset({
            sessionId: 's-a',
            completedBeforeDiscard: { summary: null, snapshot: { sessionId: 's-a' } },
            discardSummary: () => {},
            readLive: () => ({
                sessionId: null,
                phase: 'standby',
                awaitingNextCharge: true,
                completed: { summary: null, snapshot: { sessionId: 's-a' } },
            }),
            resetSidecarRoast: reset,
        });
        expect(reset).not.toHaveBeenCalled();
    });

    it('resets after a real discard on the same batch', () => {
        const reset = vi.fn();
        runSummaryDiscardSidecarReset({
            sessionId: 's-a',
            completedBeforeDiscard: {
                summary: { sessionId: 's-a' } as import('@features/active-roast/model/batch').RoastSummaryData,
                snapshot: { sessionId: 's-a' },
            },
            discardSummary: () => {},
            readLive: () => ({
                sessionId: null,
                phase: 'standby',
                awaitingNextCharge: true,
                completed: { summary: null, snapshot: { sessionId: 's-a' } },
            }),
            resetSidecarRoast: reset,
        });
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('hadSummaryBeforeSummaryDiscard ignores modal-only truthiness (M16)', () => {
        expect(hadSummaryBeforeSummaryDiscard({ summary: null })).toBe(false);
        expect(
            hadSummaryBeforeSummaryDiscard({
                summary: { sessionId: 's-a' } as import('@features/active-roast/model/batch').RoastSummaryData,
            }),
        ).toBe(true);
    });
});
