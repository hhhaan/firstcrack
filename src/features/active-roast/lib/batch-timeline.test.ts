import { combineBbpCurve } from '@shared/lib/roast-curve';
import { parseTsv } from '@shared/lib/tsv';
import { describe, expect, it } from 'vitest';
import { type BbpCapture, batchBbpPoints, captureBatchBbp, splitBatchBbp } from './batch-timeline';

const capture = (): BbpCapture => ({
    sessionId: 'a',
    generation: 'wait-a',
    startMs: 1000,
    chargeMs: 26_000,
    recording: true,
    points: [10, 20, 25, 30].map((t) => ({ t, bt: 220 - t, et: 210, heater: 0, fan: 40, drum: 50, btRaw: 221 - t })),
    events: [24, 25, 26].map((timeSec) => ({
        id: `note-${timeSec}`,
        event: 'Note',
        time: '',
        timeSec,
        temp: '',
        note: 'keep',
    })),
});

describe('batch timeline boundary', () => {
    it('retains higher-frequency waiting observations without duplicating BBP polls', () => {
        const original = capture();
        const captured = captureBatchBbp(
            { active: true, liveGeneration: 'a', ...original },
            'a',
            original.chargeMs,
            [25, 25.5, 26, 30].map((t) => ({
                time: t,
                observedAtMs: 1000 + t * 1000,
                label: '',
                bt: 195,
                et: null,
                ror: 4,
                ror_et: null,
                heater: 0,
                fan: 0,
                drum: 0,
            })),
        );
        expect(captured).not.toBeNull();
        const result = splitBatchBbp(captured as BbpCapture);
        expect(result.roastPoints.map((point) => point.time)).toEqual([0, 0.5, 1, 5]);
        expect(result.roastPoints[0].ror).toBe(4);
    });

    it('partitions all observations and events exactly once, assigning equality to roast', () => {
        const original = capture();
        const untouched = structuredClone(original);
        const result = splitBatchBbp(original);
        expect(result.before.map((p) => p.t)).toEqual([10, 20]);
        expect(result.roastPoints.map((p) => [p.time, p.btRaw])).toEqual([
            [0, 196],
            [5, 191],
        ]);
        expect(result.bbp?.events.map((e) => [e.id, e.time_sec])).toEqual([['note-24', -1]]);
        expect(result.roastEvents.map((e) => [e.id, e.timeSec])).toEqual([
            ['note-25', 0],
            ['note-26', 1],
        ]);
        expect(original).toEqual(untouched);
    });

    it('preserves a real observation gap through the existing TSV reader and History join', () => {
        const original = capture();
        const result = splitBatchBbp(original);
        const stored = parseTsv(result.bbp?.tsv ?? '');
        expect(result.bbp?.seconds).toBe(10);
        expect(combineBbpCurve([], stored, result.bbp?.seconds).points.map((p) => p.t)).toEqual([-15, -5]);
        expect(batchBbpPoints(original).map((p) => p.time)).toEqual([-15, -5]);
    });

    it('compares fractional boundary times before formatting or rounding', () => {
        const original = capture();
        original.chargeMs = 26_400;
        original.points = [25.39, 25.4, 25.41].map((t) => ({ ...original.points[0], t }));
        const result = splitBatchBbp(original);
        expect(result.before).toHaveLength(1);
        expect(result.roastPoints).toHaveLength(2);
        expect(result.roastPoints[0].time).toBe(0);
        expect(result.roastPoints[1].time).toBeCloseTo(0.01);
        const stored = parseTsv(result.bbp?.tsv ?? '');
        expect(combineBbpCurve([], stored).points[0].t).toBeCloseTo(-0.01);
    });

    it('keeps accepted events when there are no temperature observations', () => {
        const original = capture();
        original.points = [];
        expect(splitBatchBbp(original).bbp).toMatchObject({
            seconds: 0,
            chargeTemp: null,
            events: [{ id: 'note-24', time_sec: -1 }],
        });
    });

    it('keeps first-batch preheat for display without creating a saved BBP', () => {
        const original = { ...capture(), recording: false };
        expect(splitBatchBbp(original).bbp).toBeNull();
        expect(batchBbpPoints(original)).toHaveLength(2);
    });
});
