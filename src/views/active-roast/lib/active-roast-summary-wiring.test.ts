import type { CompletedRoastRestore } from '@features/active-roast/model/batch';
import { describe, expect, it } from 'vitest';
import {
    cancelDropControlWarningAfterRestore,
    planSummaryDiscardSidecarReset,
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
});
