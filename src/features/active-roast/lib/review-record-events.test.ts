import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { reviewEventsFromLog, reviewMarkToAdd } from './review-record-events';

const entry = (partial: Pick<LogEntry, 'id' | 'event' | 'timeSec'> & Partial<LogEntry>): LogEntry => ({
    time: '0:00',
    temp: '',
    note: '',
    tempC: null,
    ...partial,
});

const stored = [
    { id: 'c', type: 'Charge', time_sec: 0, temp_c: 210, note: 'Bean drop detected' },
    { id: 'tp', type: 'TP', time_sec: 119, temp_c: 145.3, note: 'Turning Point detected' },
    { id: 'ctl', type: 'Control', time_sec: 30, temp_c: null, note: null, applied_control: { heater: 40 } },
];

const baseLog = [
    entry({ id: 'c', event: 'Charge', timeSec: 0, tempC: 210, note: 'Bean drop detected' }),
    entry({ id: 'tp', event: 'TP', timeSec: 119, tempC: 145.3, note: 'Turning Point detected' }),
    entry({ id: 'ctl', event: 'Control', timeSec: 30, tempC: null }),
];

describe('reviewEventsFromLog', () => {
    it('adds a yellow mark without a note and keeps stored charge and control fields', () => {
        const result = reviewEventsFromLog(stored, [
            ...baseLog,
            entry({ id: 'y', event: 'Yellow', timeSec: 345, tempC: 172.1, note: '' }),
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.events).toContainEqual({ id: 'y', type: 'Yellow', time_sec: 345, temp_c: 172.1 });
        expect(result.events).toContainEqual(stored[0]);
        expect(result.events).toContainEqual(stored[2]);
        expect(result.changed).toBe(true);
    });

    it('sends a time edit, a note, and a custom mark in one array', () => {
        const withYellow = [...stored, { id: 'y', type: 'Yellow', time_sec: 300, temp_c: 170, note: null }];
        const result = reviewEventsFromLog(withYellow, [
            ...baseLog,
            entry({ id: 'y', event: 'Yellow', timeSec: 360, tempC: 172.1 }),
            entry({ id: 'n', event: 'Note', timeSec: 400, tempC: 180, note: 'check' }),
            entry({ id: 's', event: '시바', timeSec: 420, tempC: 185 }),
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.events).toEqual([
            stored[0],
            stored[1],
            stored[2],
            { id: 'y', type: 'Yellow', time_sec: 360, temp_c: 172.1, note: null },
            { id: 'n', type: 'Note', time_sec: 400, temp_c: 180, note: 'check' },
            { id: 's', type: '시바', time_sec: 420, temp_c: 185 },
        ]);
    });

    it('stores a gas-only note as note null plus gas', () => {
        const result = reviewEventsFromLog(stored, [
            ...baseLog,
            entry({ id: 'n', event: 'Note', timeSec: 100, tempC: null, note: '', gas: 'afdsf' }),
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.events).toContainEqual({
            id: 'n',
            type: 'Note',
            time_sec: 100,
            temp_c: null,
            note: null,
            gas: 'afdsf',
        });
    });

    it('rejects a second yellow, an order inversion, and deleting yellow', () => {
        const withYellow = [...stored, { id: 'y', type: 'Yellow', time_sec: 345, temp_c: 172.1, note: null }];
        const yellow = entry({ id: 'y', event: 'Yellow', timeSec: 345, tempC: 172.1 });
        expect(
            reviewEventsFromLog(withYellow, [
                ...baseLog,
                yellow,
                entry({ id: 'y2', event: 'Yellow', timeSec: 400, tempC: 180 }),
            ]),
        ).toEqual({ ok: false, reason: 'duplicate' });
        expect(
            reviewEventsFromLog(withYellow, [...baseLog, entry({ id: 'y', event: 'Yellow', timeSec: 60, tempC: 150 })]),
        ).toEqual({ ok: false, reason: 'order' });
        expect(reviewEventsFromLog(withYellow, baseLog)).toEqual({ ok: false, reason: 'protected' });
    });
});

describe('reviewMarkToAdd', () => {
    it('adds a missing yellow once and still adds a repeated custom name', () => {
        const yellow = entry({ id: 'y', event: 'Yellow', timeSec: 1 });
        expect(reviewMarkToAdd([], 'Yellow', false)).toBe('Yellow');
        expect(reviewMarkToAdd([yellow], 'Yellow', false)).toBeNull();
        expect(reviewMarkToAdd([yellow], '시바', false)).toBe('시바');
        expect(reviewMarkToAdd([], 'Drop', false)).toBeNull();
    });
});
