import type { LogEntry } from '@shared/types/roast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    bbpDisplayTime,
    bbpEventsForDisplay,
    bbpEventsFromDisplay,
    bbpStoredTime,
    isBbpAllowedEvent,
    makeBbpLogEntry,
} from './bbp-events';

const note = (timeSec: number, id = `n-${timeSec}`): LogEntry => ({
    id,
    event: 'Note',
    time: '0:00',
    timeSec,
    temp: '',
    tempC: null,
    note: 'preheat',
});

describe('isBbpAllowedEvent', () => {
    it.each(['Note', 'Heater', 'Control'])('allows %s', (event) => {
        expect(isBbpAllowedEvent(event)).toBe(true);
    });

    it.each(['Yellow', 'FC Start', 'FC Rolling', 'FC End', 'Drop', 'Charge', 'End', 'TP', 'Aroma'])(
        'rejects %s',
        (event) => {
            expect(isBbpAllowedEvent(event)).toBe(false);
        },
    );
});

describe('BBP event times', () => {
    it('maps End-relative times onto the live 0-based window', () => {
        expect(bbpDisplayTime(61, 1)).toBe(60);
        expect(bbpStoredTime(60, 1)).toBe(61);
        expect(bbpEventsForDisplay([note(61), note(0)], 1).map((entry) => entry.timeSec)).toEqual([60]);
        expect(bbpEventsFromDisplay([note(60)], 1)[0]?.timeSec).toBe(61);
    });
});

describe('makeBbpLogEntry', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('records a gas note and rejects a crack mark', () => {
        vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('bbp-note') });
        expect(makeBbpLogEntry('Note', '', 90, 195, 'C', { gas: ' 70 ' })).toMatchObject({
            id: 'bbp-note',
            event: 'Note',
            timeSec: 90,
            gas: '70',
            tempC: 195,
        });
        expect(makeBbpLogEntry('FC Start', '', 90, 195, 'C')).toBeNull();
        expect(makeBbpLogEntry('Note', '   ', 90, null, 'C')).toBeNull();
    });
});
