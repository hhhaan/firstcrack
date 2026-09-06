import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { applyEventMarkerDrag, nearestLivePointAt } from './event-marker-drag';

const entry = (event: string, timeSec: number, tempC: number): LogEntry => ({
    id: event,
    time: formatElapsed(timeSec),
    timeSec,
    event,
    temp: `${tempC.toFixed(1)}°C`,
    tempC,
    note: '',
});

describe('nearestLivePointAt', () => {
    it('returns null for empty series', () => {
        expect(nearestLivePointAt([], 10)).toBeNull();
    });

    it('picks closest sample by time', () => {
        const points = [
            { time: 0, bt: 100 },
            { time: 10, bt: 150 },
            { time: 20, bt: 180 },
        ];
        expect(nearestLivePointAt(points, 9)?.bt).toBe(150);
        expect(nearestLivePointAt(points, 16)?.bt).toBe(180);
    });
});

describe('applyEventMarkerDrag', () => {
    const livePoints = [
        { time: 0, bt: 100 },
        { time: 30, bt: 160 },
        { time: 60, bt: 200 },
        { time: 90, bt: 210 },
    ];

    it('updates moved entry temp/tempC from nearest point and sorts by timeSec', () => {
        const entries: LogEntry[] = [entry('Yellow', 40, 140), entry('FC Start', 70, 190), entry('Drop', 100, 205)];

        // Drag FC Start earlier past Yellow (70 → 20) — nearest bt at 30s is 160
        const next = applyEventMarkerDrag(entries, 'FC Start', 20, livePoints, 'C');

        expect(next.map((e) => e.event)).toEqual(['FC Start', 'Yellow', 'Drop']);
        const moved = next.find((e) => e.event === 'FC Start');
        expect(moved?.timeSec).toBe(20);
        expect(moved?.tempC).toBe(160);
        expect(moved?.temp).toBe('160.0°C');
        // others unchanged temps
        expect(next.find((e) => e.event === 'Yellow')?.tempC).toBe(140);
    });

    it('keeps prior temp when no live points, still updates time and sorts', () => {
        const entries: LogEntry[] = [entry('Drop', 10, 120), entry('Yellow', 50, 150)];
        const next = applyEventMarkerDrag(entries, 'Yellow', 5, [], 'C');
        expect(next.map((e) => e.event)).toEqual(['Yellow', 'Drop']);
        expect(next[0].timeSec).toBe(5);
        expect(next[0].tempC).toBe(150);
    });
});
