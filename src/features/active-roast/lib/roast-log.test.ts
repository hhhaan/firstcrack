import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { dropTempC, fcStart, hasDropped, heaterAutoOff, isFinished, phaseAt, yellow } from './roast-log';

const entry = (event: string, timeSec = 100, tempC: number | null = 200): LogEntry => ({
    id: `${event}-${timeSec}`,
    time: '1:40',
    timeSec,
    event,
    temp: tempC == null ? '' : `${tempC}.0°C`,
    tempC,
    note: '',
});

describe('roast-log predicates', () => {
    it('fcStart / yellow find the named mark', () => {
        const entries = [entry('Charge', 0), entry('Yellow', 240, 150), entry('FC Start', 480, 196)];
        expect(fcStart(entries)?.timeSec).toBe(480);
        expect(yellow(entries)?.tempC).toBe(150);
        expect(fcStart([])).toBeUndefined();
        expect(yellow([])).toBeUndefined();
    });

    it('phaseAt uses elapsed vs mark time', () => {
        const entries = [entry('Yellow', 240), entry('FC Start', 480)];
        expect(phaseAt(entries, 100)).toBe('Drying');
        expect(phaseAt(entries, 240)).toBe('Maillard');
        expect(phaseAt(entries, 480)).toBe('Development');
        expect(phaseAt([], 100)).toBe('Drying');
    });
});

/**
 * "끝났나" 4갈래 × 소비자 기대값.
 * heaterAutoOff: Drop (not End-only) or session ended.
 * alerts / auto-detection: Drop || End.
 * auto-drop skip: Drop only.
 * drop temp: Drop then End then fallback.
 */
describe('roast-log finished table', () => {
    const drop = entry('Drop', 600, 205);
    const end = entry('End', 610, 202);
    const fallbackBt = 199;

    const cases: {
        name: string;
        entries: LogEntry[];
        heater: boolean;
        finished: boolean;
        dropped: boolean;
        temp: number;
    }[] = [
        { name: 'none', entries: [], heater: false, finished: false, dropped: false, temp: fallbackBt },
        { name: 'Drop', entries: [drop], heater: true, finished: true, dropped: true, temp: 205 },
        { name: 'End', entries: [end], heater: false, finished: true, dropped: false, temp: 202 },
        { name: 'Drop+End', entries: [drop, end], heater: true, finished: true, dropped: true, temp: 205 },
    ];

    it.each(cases)('$name', ({ entries, heater, finished, dropped, temp }) => {
        expect(heaterAutoOff(false, entries)).toBe(heater);
        expect(heaterAutoOff(true, entries)).toBe(true);
        expect(isFinished(entries)).toBe(finished);
        expect(hasDropped(entries)).toBe(dropped);
        expect(dropTempC(entries, fallbackBt)).toBe(temp);
    });
});
