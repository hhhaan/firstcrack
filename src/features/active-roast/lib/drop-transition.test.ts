import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it, vi } from 'vitest';
import {
    buildDropSummary,
    canCancelDrop,
    clipRoastPointsAtDrop,
    type DropCurvePoint,
    dropBbpStartMs,
    foldPostDropPointsToBbp,
    planDropTransition,
} from './drop-transition';

const pt = (time: number, bt: number): DropCurvePoint => ({
    time,
    bt,
    et: 210,
    heater: 50,
    fan: 40,
    drum: 60,
});

const log = (event: string, timeSec: number, tempC: number | null = 200): LogEntry => ({
    id: event,
    time: `${Math.floor(timeSec / 60)}:${String(timeSec % 60).padStart(2, '0')}`,
    timeSec,
    event,
    temp: '0',
    tempC,
    note: '',
});

describe('dropBbpStartMs', () => {
    it('is roastStartMs + Drop seconds, not End-confirm wall clock', () => {
        expect(dropBbpStartMs(1_000_000, 600)).toBe(1_600_000);
        expect(dropBbpStartMs(1_000_000, 0)).toBe(1_000_000);
    });
});

describe('foldPostDropPointsToBbp', () => {
    it('moves auto-Drop lookback samples onto BBP t=0 at Drop', () => {
        const seed = foldPostDropPointsToBbp([pt(598, 205), pt(600, 204), pt(601.5, 150), pt(603, 148)], 600);
        expect(seed.map((p) => [p.t, p.bt])).toEqual([
            [0, 204],
            [1.5, 150],
            [3, 148],
        ]);
    });
});

describe('clipRoastPointsAtDrop', () => {
    it('keeps the Drop boundary on the roast curve', () => {
        expect(clipRoastPointsAtDrop([pt(599, 205), pt(600, 204), pt(601, 150)], 600).map((p) => p.time)).toEqual([
            599, 600,
        ]);
    });
});

describe('canCancelDrop', () => {
    it('allows cancel only before next Charge and before server save', () => {
        expect(canCancelDrop({ nextCharged: false, submitted: false })).toBe(true);
        expect(canCancelDrop({ nextCharged: true, submitted: false })).toBe(false);
        expect(canCancelDrop({ nextCharged: false, submitted: true })).toBe(false);
    });
});

describe('buildDropSummary', () => {
    it('fixes duration / DTR / discharge temp at Drop, ignoring later elapsed', () => {
        const logs = [log('Charge', 0, 210), log('FC Start', 480, 196), log('Drop', 600, 205)];
        const summary = buildDropSummary(logs, 600, 205, 'C', 's-a');
        expect(summary.totalTime).toBe('10:00');
        expect(summary.development).toBe('2:00 (20%)');
        expect(summary.finalBt).toBe('205°C');
        expect(summary.elapsedSec).toBe(600);
        expect(summary.sessionId).toBe('s-a');
    });
});

describe('planDropTransition', () => {
    const base = {
        sessionId: 's-a',
        charged: true,
        phase: 'roasting',
        roastStartMs: 1_000_000,
        elapsed: 612,
        rawBT: 201,
        unit: 'C' as const,
        logEntries: [log('Charge', 0, 210), log('FC Start', 480, 196)],
        livePoints: [pt(598, 206), pt(600, 205), pt(612, 150)],
        droppedSessionId: null as string | null,
    };

    it('manual Drop uses current elapsed when no onset is given', () => {
        const result = planDropTransition(base);
        expect(result).not.toBeNull();
        expect(result?.dropTimeSec).toBe(612);
        expect(result?.dropBt).toBe(201);
        expect(result?.bbpStartMs).toBe(1_612_000);
        expect(result?.logEntries.some((e) => e.event === 'Drop' && e.timeSec === 612)).toBe(true);
        expect(result?.summary.totalTime).toBe('10:12');
    });

    it('auto Drop label rounds 686.6s to 11:27 and 205.4°C to 205°C', () => {
        const result = planDropTransition({
            ...base,
            elapsed: 690,
            onset: { timeSec: 686.6, bt: 205.4 },
        });
        const drop = result?.logEntries.find((e) => e.event === 'Drop');
        expect(drop?.time).toBe('11:27');
        expect(drop?.timeSec).toBe(686.6);
        expect(drop?.temp).toBe('205°C');
        expect(result?.summary.totalTime).toBe('11:27');
        expect(result?.summary.finalBt).toBe('205°C');
    });

    it('auto Drop uses onset and folds lookback into BBP seed', () => {
        const result = planDropTransition({ ...base, onset: { timeSec: 600, bt: 205 } });
        expect(result?.dropTimeSec).toBe(600);
        expect(result?.dropBt).toBe(205);
        expect(result?.bbpStartMs).toBe(1_600_000);
        expect(result?.roastPoints.map((p) => p.time)).toEqual([598, 600]);
        expect(result?.bbpSeed.map((p) => [p.t, p.bt])).toEqual([
            [0, 205],
            [12, 150],
        ]);
        expect(result?.summary.totalTime).toBe('10:00');
        expect(result?.summary.finalBt).toBe('205°C');
        expect(result?.summary.development).toBe('2:00 (20%)');
    });

    it('is idempotent per sessionId', () => {
        expect(planDropTransition({ ...base, droppedSessionId: 's-a' })).toBeNull();
        expect(planDropTransition({ ...base, sessionId: null })).toBeNull();
        expect(planDropTransition({ ...base, charged: false })).toBeNull();
        expect(planDropTransition({ ...base, phase: 'standby' })).toBeNull();
    });

    it('does not duplicate an existing Drop log', () => {
        vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'new-id') });
        const withDrop = {
            ...base,
            logEntries: [...base.logEntries, log('Drop', 600, 205)],
            onset: { timeSec: 600, bt: 205 },
        };
        const result = planDropTransition(withDrop);
        expect(result?.logEntries.filter((e) => e.event === 'Drop')).toHaveLength(1);
        expect(crypto.randomUUID).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
