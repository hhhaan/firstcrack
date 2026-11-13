import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { reviewPointsThroughDrop } from './review-curve';

const entry = (event: string, timeSec: number): LogEntry => ({
    id: event,
    event,
    time: '',
    timeSec,
    temp: '',
    tempC: null,
    note: '',
});
const points = [{ time: -30 }, { time: 0 }, { time: 300 }, { time: 540 }, { time: 600 }];

describe('review curve end', () => {
    it('ends the reviewed curve at a Drop the saved record moved earlier', () => {
        const drawn = reviewPointsThroughDrop(points, [entry('Charge', 0), entry('Drop', 540)]);
        expect(drawn.map((point) => point.time)).toEqual([-30, 0, 300, 540]);
        expect(points).toHaveLength(5);
    });

    it('returns the snapshot samples untouched for an unedited Drop, an End mark, or no entries', () => {
        expect(reviewPointsThroughDrop(points, [entry('Drop', 600)])).toBe(points);
        expect(reviewPointsThroughDrop(points, [entry('Drop', 540), entry('End', 600)])).toBe(points);
        expect(reviewPointsThroughDrop(points, [entry('Charge', 0)])).toBe(points);
        expect(reviewPointsThroughDrop(points, null)).toBe(points);
    });
});
