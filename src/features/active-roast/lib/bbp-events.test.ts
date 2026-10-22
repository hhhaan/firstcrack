import type { LogEntry } from '@shared/types/roast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    bbpCurveDuration,
    bbpDisplayTime,
    bbpEventsForDisplay,
    bbpEventsFromDisplay,
    bbpStoredTime,
    clipBbpEventsToWindow,
    isBbpAllowedEvent,
    makeBbpLogEntry,
    rebaseBbpEvents,
    toChargeRelativeBbpEvents,
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

    it('drops events that slid out of the 15-minute window and rebases the rest', () => {
        const events = [note(1), note(60), note(960)];
        expect(clipBbpEventsToWindow(events, 960).map((entry) => entry.timeSec)).toEqual([60, 960]);
        expect(rebaseBbpEvents(events, 960).map((entry) => entry.timeSec)).toEqual([0, 900]);
    });

    it('stores a 1:00 note on a 4:00 wait at −3:00 so History can draw it on BBP', () => {
        const events = [note(60, 'gas')];
        const points = [{ t: 0 }, { t: 240 }];
        expect(bbpCurveDuration(points, 240)).toBe(240);
        expect(toChargeRelativeBbpEvents(events, points, 240)).toEqual([
            expect.objectContaining({ id: 'gas', type: 'Note', time_sec: -180, note: 'preheat' }),
        ]);
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
