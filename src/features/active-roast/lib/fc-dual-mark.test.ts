import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it, vi } from 'vitest';
import { cycleFcDualEntries, fcDualButtonLabel, getFcDualStage, withoutLogEvent } from './fc-dual-mark';

const entry = (event: string, timeSec = 100): LogEntry => ({
    id: `${event}-${timeSec}`,
    time: '1:40',
    timeSec,
    event,
    temp: '200.0°C',
    tempC: 200,
    note: '',
});

const ctx = { elapsed: 500, rawBT: 196, unit: 'C' as const };

describe('getFcDualStage', () => {
    it('returns 0 when empty', () => {
        expect(getFcDualStage([])).toBe(0);
    });

    it('returns 1 with FC Start only', () => {
        expect(getFcDualStage([entry('FC Start')])).toBe(1);
    });

    it('returns 2 with both', () => {
        expect(getFcDualStage([entry('FC Start'), entry('FC Rolling', 520)])).toBe(2);
    });

    it('returns 0 for orphan Rolling', () => {
        expect(getFcDualStage([entry('FC Rolling')])).toBe(0);
    });
});

describe('fcDualButtonLabel', () => {
    it('Start at stage 0, Rolling at 1 and 2', () => {
        expect(fcDualButtonLabel(0)).toBe('FC Start');
        expect(fcDualButtonLabel(1)).toBe('FC Rolling');
        expect(fcDualButtonLabel(2)).toBe('FC Rolling');
    });
});

describe('cycleFcDualEntries', () => {
    it('cycles 0 → Start → Rolling; stage 2 removes Rolling (#453)', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('00000000-0000-0000-0000-00000000000a')
            .mockReturnValueOnce('00000000-0000-0000-0000-00000000000b');

        const s1 = cycleFcDualEntries([], ctx);
        expect(s1).toHaveLength(1);
        expect(s1[0]).toMatchObject({
            event: 'FC Start',
            note: 'First crack started',
            timeSec: 500,
            tempC: 196,
        });

        const s2 = cycleFcDualEntries(s1, { ...ctx, elapsed: 540, rawBT: 201 });
        expect(s2.map((e) => e.event)).toEqual(['FC Start', 'FC Rolling']);
        expect(s2[1]).toMatchObject({
            event: 'FC Rolling',
            note: 'First crack rolling',
            timeSec: 540,
        });

        const s3 = cycleFcDualEntries(s2, ctx);
        expect(s3.map((e) => e.event)).toEqual(['FC Start']);
    });

    it('clears orphan Rolling on cycle', () => {
        const next = cycleFcDualEntries([entry('FC Rolling', 480), entry('Yellow', 300)], ctx);
        expect(next.map((e) => e.event)).toEqual(['Yellow']);
    });

    it('third cycle removes Rolling and keeps Start + other events', () => {
        const prev = [entry('Yellow', 240), entry('FC Start', 480), entry('FC Rolling', 520)];
        const next = cycleFcDualEntries(prev, ctx);
        expect(next.map((e) => e.event)).toEqual(['Yellow', 'FC Start']);
    });

    it('fourth cycle from Start-only re-adds Rolling', () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-00000000000c');
        const prev = [entry('Yellow', 240), entry('FC Start', 480)];
        const next = cycleFcDualEntries(prev, ctx);
        expect(next.map((e) => e.event)).toEqual(['Yellow', 'FC Start', 'FC Rolling']);
    });

    it('sorts by time after insert', () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-00000000000x');
        const prev = [entry('Yellow', 600)];
        const next = cycleFcDualEntries(prev, { ...ctx, elapsed: 100 });
        expect(next.map((e) => e.event)).toEqual(['FC Start', 'Yellow']);
    });
});

describe('withoutLogEvent', () => {
    it('removing FC Start also drops Rolling', () => {
        const prev = [entry('Yellow', 240), entry('FC Start', 480), entry('FC Rolling', 520)];
        expect(withoutLogEvent(prev, 'FC Start').map((e) => e.event)).toEqual(['Yellow']);
    });

    it('removing FC Rolling keeps Start', () => {
        const prev = [entry('FC Start', 480), entry('FC Rolling', 520)];
        expect(withoutLogEvent(prev, 'FC Rolling').map((e) => e.event)).toEqual(['FC Start']);
    });
});
