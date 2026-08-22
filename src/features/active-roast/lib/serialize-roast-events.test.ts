import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it, vi } from 'vitest';
import {
    logEntryTimeSec,
    parseStoredRoastEvents,
    serializeRoastEvents,
    storedEventsToLogEntries,
    storedEventsToMarkers,
} from './serialize-roast-events';

describe('serializeRoastEvents', () => {
    it('serializes timeSec and tempC', () => {
        const entries: LogEntry[] = [
            {
                id: 'a',
                time: '0:00',
                timeSec: 0,
                event: 'Charge',
                temp: '200.0°C',
                tempC: 200,
                note: 'in',
            },
            {
                id: 'b',
                time: '8:30',
                timeSec: 510,
                event: 'FC Start',
                temp: '196.0°C',
                tempC: 196,
                note: '',
            },
        ];
        expect(serializeRoastEvents(entries)).toEqual([
            { id: 'a', type: 'Charge', time_sec: 0, temp_c: 200, note: 'in' },
            { id: 'b', type: 'FC Start', time_sec: 510, temp_c: 196, note: null },
        ]);
    });

    it('falls back to parseTimeSec when timeSec missing', () => {
        const entries: LogEntry[] = [{ time: '1:05', event: 'Yellow', temp: '', note: '' }];
        expect(serializeRoastEvents(entries)[0].time_sec).toBe(65);
    });

    it('skips ephemeral Now / current rows', () => {
        const entries: LogEntry[] = [
            { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', tempC: 100, note: '' },
            { time: '2:00', event: 'Now', temp: '', note: 'x', current: true },
        ];
        expect(serializeRoastEvents(entries)).toHaveLength(1);
        expect(serializeRoastEvents(entries)[0].type).toBe('Charge');
    });

    it('sorts by time_sec', () => {
        const entries: LogEntry[] = [
            { id: '2', time: '2:00', timeSec: 120, event: 'Yellow', temp: '', tempC: 1, note: '' },
            { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', tempC: 1, note: '' },
        ];
        expect(serializeRoastEvents(entries).map((e) => e.type)).toEqual(['Charge', 'Yellow']);
    });
});

describe('logEntryTimeSec', () => {
    it('prefers timeSec', () => {
        expect(logEntryTimeSec({ time: '1:00', timeSec: 59.5 })).toBe(59.5);
    });
});

describe('parseStoredRoastEvents', () => {
    it('returns [] for non-array', () => {
        expect(parseStoredRoastEvents(null)).toEqual([]);
        expect(parseStoredRoastEvents({})).toEqual([]);
    });

    it('drops invalid rows', () => {
        expect(
            parseStoredRoastEvents([
                { id: '1', type: 'FC Start', time_sec: 100 },
                { type: 'Drop' },
                null,
                { type: 'X', time_sec: 'bad' },
            ]),
        ).toEqual([{ id: '1', type: 'FC Start', time_sec: 100, temp_c: undefined, note: undefined }]);
    });
});

describe('storedEventsToLogEntries', () => {
    it('maps stored events to read-only log rows', () => {
        expect(
            storedEventsToLogEntries(
                [
                    { id: '2', type: 'Yellow', time_sec: 120, temp_c: 165.2 },
                    { id: '1', type: 'Charge', time_sec: 0, temp_c: 200, note: 'start' },
                    { id: '3', type: 'Note', time_sec: 300, note: 'check aroma' },
                ],
                'C',
            ),
        ).toEqual([
            {
                id: '1',
                time: '0:00',
                timeSec: 0,
                event: 'Charge',
                temp: '200°C',
                tempC: 200,
                note: 'start',
            },
            {
                id: '2',
                time: '2:00',
                timeSec: 120,
                event: 'Yellow',
                temp: '165°C',
                tempC: 165.2,
                note: '',
            },
            {
                id: '3',
                time: '5:00',
                timeSec: 300,
                event: 'Note',
                temp: '—',
                tempC: null,
                note: 'check aroma',
            },
        ]);
    });

    it('converts log temps with toDisplayTemp', () => {
        const [row] = storedEventsToLogEntries([{ id: '1', type: 'Drop', time_sec: 600, temp_c: 210 }], 'F');
        expect(row.temp).toBe('410°F');
        expect(row.tempC).toBe(210);
    });
});

describe('storedEventsToMarkers', () => {
    it('filters TP and Note like live markers', () => {
        // getResolvedEventColor reads CSS vars via getComputedStyle
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#abc' }));

        const markers = storedEventsToMarkers([
            { id: '1', type: 'Charge', time_sec: 0 },
            { id: '2', type: 'TP', time_sec: 60 },
            { id: '3', type: 'Note', time_sec: 90, note: 'hi' },
            { id: '4', type: 'Drop', time_sec: 600, temp_c: 210 },
        ]);
        expect(markers.map((m) => m.event)).toEqual(['Charge', 'Drop']);
        expect(markers[1].temp).toBe('210');
        expect(markers[1].timeStr).toBe('10:00');
        expect(markers[0].color).toBe('#abc');

        const fMarkers = storedEventsToMarkers([{ id: '4', type: 'Drop', time_sec: 600, temp_c: 210 }], 'F');
        expect(fMarkers[0].temp).toBe('410');

        vi.unstubAllGlobals();
    });
});
