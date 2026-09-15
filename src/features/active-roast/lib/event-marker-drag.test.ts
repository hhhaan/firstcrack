import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { applyEventMarkerDrag, applyEventMarkerEdit, nearestLivePointAt } from './event-marker-drag';

const entry = (id: string, event: string, timeSec: number, tempC: number, note = ''): LogEntry => ({
    id,
    time: `${Math.floor(timeSec / 60)}:${String(Math.floor(timeSec % 60)).padStart(2, '0')}`,
    timeSec,
    event,
    temp: `${tempC.toFixed(1)}°C`,
    tempC,
    note,
});

describe('nearestLivePointAt', () => {
    it('returns null for empty or nonfinite input', () => {
        expect(nearestLivePointAt([], 10)).toBeNull();
        expect(nearestLivePointAt([{ time: 0, bt: 100 }], Number.NaN)).toBeNull();
    });

    it('picks the first closest valid post-charge sample', () => {
        const points = [
            { time: -1, bt: 90 },
            { time: 0, bt: 100 },
            { time: 5, bt: Number.NaN },
            { time: 10, bt: 150 },
            { time: 20, bt: 180 },
            { time: Number.POSITIVE_INFINITY, bt: 999 },
        ];
        expect(nearestLivePointAt(points, 5)).toEqual({ time: 0, bt: 100 });
        expect(nearestLivePointAt(points, 16)).toEqual({ time: 20, bt: 180 });
    });
});

describe('applyEventMarkerDrag', () => {
    const livePoints = [
        { time: -10, bt: 220 },
        { time: 0, bt: 100 },
        { time: 30, bt: 160 },
        { time: 60, bt: 200 },
        { time: 90, bt: 210 },
    ];

    it('moves only the selected ID across another event and preserves its body', () => {
        const entries = [
            entry('note-a', 'Note', 40, 140, 'first'),
            entry('note-b', 'Note', 70, 190, 'second'),
            entry('drop', 'Drop', 100, 205),
        ];

        const next = applyEventMarkerDrag(entries, 'note-b', 20, livePoints, 'C', 120);

        expect(next.map((e) => e.id)).toEqual(['note-b', 'note-a', 'drop']);
        expect(next[0]).toMatchObject({ time: '0:20', timeSec: 20, temp: '160.0°C', tempC: 160, note: 'second' });
        expect(next.find((e) => e.id === 'note-a')).toBe(entries[0]);
    });

    it('keeps equal-time Notes independently identifiable and stably ordered', () => {
        const entries = [entry('note-a', 'Note', 10, 120, 'first'), entry('note-b', 'Note', 20, 130, 'second')];
        const next = applyEventMarkerDrag(entries, 'note-b', 10, livePoints, 'C', 20);

        expect(next.map((e) => [e.id, e.note, e.timeSec])).toEqual([
            ['note-a', 'first', 10],
            ['note-b', 'second', 10],
        ]);
    });

    it('rejects missing IDs and immutable Charge', () => {
        const entries = [entry('charge', 'Charge', 0, 200), entry('heater', 'Heater', 30, 160, '50%')];

        expect(applyEventMarkerDrag(entries, undefined, 20, livePoints, 'C', 100)).toBe(entries);
        expect(applyEventMarkerDrag(entries, 'missing', 20, livePoints, 'C', 100)).toBe(entries);
        expect(applyEventMarkerDrag(entries, 'charge', 20, livePoints, 'C', 100)).toBe(entries);
    });

    it('moves Heater time and keeps the committed heat note', () => {
        const entries = [entry('heater', 'Heater', 30, 160, '50%')];
        const next = applyEventMarkerDrag(entries, 'heater', 60, livePoints, 'C', 90);
        expect(next[0]).toMatchObject({ timeSec: 60, tempC: 200, note: '50%' });
    });

    it('rounds and clamps time to the recorded interval, including zero', () => {
        const entries = [entry('yellow', 'Yellow', 50, 150)];

        expect(applyEventMarkerDrag(entries, 'yellow', -2, livePoints, 'C', 75)[0].timeSec).toBe(0);
        expect(applyEventMarkerDrag(entries, 'yellow', 200, livePoints, 'C', 75)[0].timeSec).toBe(75);
        expect(applyEventMarkerDrag(entries, 'yellow', 10.6, livePoints, 'C', 75)[0].timeSec).toBe(11);
    });

    it('rejects nonfinite time or invalid upper bounds', () => {
        const entries = [entry('yellow', 'Yellow', 50, 150)];
        expect(applyEventMarkerDrag(entries, 'yellow', Number.NaN, livePoints, 'C', 75)).toBe(entries);
        expect(applyEventMarkerDrag(entries, 'yellow', Number.POSITIVE_INFINITY, livePoints, 'C', 75)).toBe(entries);
        expect(applyEventMarkerDrag(entries, 'yellow', 20, livePoints, 'C', Number.NaN)).toBe(entries);
        expect(applyEventMarkerDrag(entries, 'yellow', 20, livePoints, 'C', -1)).toBe(entries);
    });

    it('keeps prior raw and display temperature when no valid sample exists', () => {
        const entries = [entry('yellow', 'Yellow', 50, 150)];
        const invalidPoints = [
            { time: -1, bt: 100 },
            { time: 5, bt: Number.NaN },
        ];
        const next = applyEventMarkerDrag(entries, 'yellow', 5, invalidPoints, 'C', 60);

        expect(next[0]).toMatchObject({ timeSec: 5, tempC: 150, temp: '150.0°C' });
    });

    it('stores Celsius while formatting the selected unit', () => {
        const entries = [entry('yellow', 'Yellow', 50, 150)];
        const c = applyEventMarkerDrag(entries, 'yellow', 30, livePoints, 'C', 60)[0];
        const f = applyEventMarkerDrag(entries, 'yellow', 30, livePoints, 'F', 60)[0];

        expect(c).toMatchObject({ tempC: 160, temp: '160.0°C' });
        expect(f).toMatchObject({ tempC: 160, temp: '320.0°F' });
    });
});

describe('applyEventMarkerEdit', () => {
    const livePoints = [
        { time: 0, bt: 100 },
        { time: 30, bt: 160 },
        { time: 60, bt: 200 },
    ];

    it('updates Heater heat without moving time', () => {
        const entries = [entry('heater', 'Heater', 30, 160, '50%')];
        const next = applyEventMarkerEdit(entries, 'heater', { note: '70%' }, livePoints, 'C', 90);
        expect(next[0]).toMatchObject({ timeSec: 30, tempC: 160, note: '70%' });
    });

    it('updates Note body and time together', () => {
        const entries = [entry('note-a', 'Note', 30, 160, 'old')];
        const next = applyEventMarkerEdit(entries, 'note-a', { timeSec: 60, note: 'damper' }, livePoints, 'C', 90);
        expect(next[0]).toMatchObject({ timeSec: 60, tempC: 200, note: 'damper' });
    });

    it('ignores note patches on phase events', () => {
        const entries = [entry('drop', 'Drop', 60, 200, 'Coffee dropped')];
        const next = applyEventMarkerEdit(entries, 'drop', { note: 'nope' }, livePoints, 'C', 90);
        expect(next[0]).toBe(entries[0]);
    });
});
