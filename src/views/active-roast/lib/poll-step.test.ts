import { describe, expect, it } from 'vitest';
import { convertPreChargeBuffer, type PollReading, type PollSessionState, stepPoll } from './poll-step';

const reading = (bt = 200): PollReading => ({
    bt,
    et: 210,
    ror: 5,
    ror_et: 4,
    heater: 80,
    fan: 40,
    drum: 60,
});

const session = (over: Partial<PollSessionState> = {}): PollSessionState => ({
    phase: 'roasting',
    nowMs: 10_000,
    roastStartMs: 0,
    sessionId: 's1',
    lastRoastPointTime: null,
    lastStandbyAbsTime: null,
    preChargeStartMs: 0,
    ...over,
});

describe('stepPoll', () => {
    it('gates BBP to non-roasting phases', () => {
        expect(stepPoll(reading(), session({ phase: 'roasting', roastStartMs: 1000 })).bbp).toBeUndefined();
        expect(stepPoll(reading(), session({ phase: 'standby' })).bbp).toEqual(reading());
        expect(stepPoll(reading(), session({ phase: 'preheating' })).bbp).toEqual(reading());
        expect(stepPoll(reading(), session({ phase: 'ended' })).bbp).toEqual(reading());
    });

    it('roasting: elapsed, livePoint, TSV; skips TSV without session', () => {
        const r = stepPoll(reading(), session({ roastStartMs: 1000, nowMs: 61000, sessionId: 's1' }));
        expect(r.elapsedSec).toBe(60);
        expect(r.livePoint?.time).toBe(60);
        expect(r.livePoint?.label).toBe('1:00');
        expect(r.tsvRow).toBe('60.00\t200\t210\t5\t80\t40\t60\n');
        expect(
            stepPoll(reading(), session({ roastStartMs: 1000, nowMs: 61000, sessionId: null })).tsvRow,
        ).toBeUndefined();
    });

    it('roasting early-return: dedupe under 0.4s still writes elapsed', () => {
        const started = stepPoll(reading(), session({ roastStartMs: 1000, nowMs: 1400, lastRoastPointTime: 0.3 }));
        expect(started.elapsedSec).toBe(0);
        expect(started.livePoint).toBeUndefined();
        expect(started.tsvRow).toBeUndefined();
    });

    it('roasting without charge origin emits no point', () => {
        const r = stepPoll(reading(), session({ phase: 'roasting', roastStartMs: 0 }));
        expect(r.livePoint).toBeUndefined();
        expect(r.elapsedSec).toBeUndefined();
    });

    it('standby: buffer + livePoint; dedupe under 400ms', () => {
        const first = stepPoll(reading(), session({ phase: 'standby', nowMs: 5000, preChargeStartMs: 0 }));
        expect(first.preChargeStartMs).toBe(5000);
        expect(first.bufferPush?.absTime).toBe(5000);
        expect(first.livePoint?.label).toBe('0:00');
        const dup = stepPoll(
            reading(),
            session({ phase: 'standby', nowMs: 5300, lastStandbyAbsTime: 5000, preChargeStartMs: 5000 }),
        );
        expect(dup.livePoint).toBeUndefined();
        expect(dup.bufferPush).toBeUndefined();
        expect(dup.bbp).toEqual(reading());
    });

    it('preheating/ended: BBP only, no livePoint', () => {
        const r = stepPoll(reading(), session({ phase: 'preheating', nowMs: 1000 }));
        expect(r.bbp).toBeDefined();
        expect(r.livePoint).toBeUndefined();
        expect(r.tsvRow).toBeUndefined();
    });
});

describe('convertPreChargeBuffer', () => {
    it('maps samples in the lookback window to negative-time points', () => {
        const charge = 10_000;
        const pts = convertPreChargeBuffer(
            [
                { absTime: 1000, bt: 1, et: null, ror: null, ror_et: null, heater: null, fan: 0, drum: 0 },
                { absTime: 8000, bt: 180, et: 190, ror: 1, ror_et: 1, heater: 50, fan: 10, drum: 20 },
            ],
            charge,
            5,
        );
        expect(pts).toHaveLength(1);
        expect(pts[0].time).toBe(-2);
        expect(pts[0].label).toBe('-0:02');
        expect(pts[0].bt).toBe(180);
    });

    it('returns empty when charge time is 0 or buffer is empty', () => {
        expect(convertPreChargeBuffer([], 10_000, 30)).toEqual([]);
        expect(
            convertPreChargeBuffer(
                [{ absTime: 1, bt: 1, et: null, ror: null, ror_et: null, heater: null, fan: 0, drum: 0 }],
                0,
                30,
            ),
        ).toEqual([]);
    });
});
