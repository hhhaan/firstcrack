import { describe, expect, it } from 'vitest';
import { detectTurningPoints } from './turningPoints';

/** Build monotonic time axis 0..n-1 sec with given BT series. */
const axis = (bt: number[]) => ({
    xs: bt.map((_, i) => i),
    bt,
});

describe('detectTurningPoints', () => {
    it('returns empty when fewer than 15 samples', () => {
        const bt = Array.from({ length: 10 }, (_, i) => 200 - i);
        expect(detectTurningPoints(axis(bt).xs, bt)).toEqual([]);
    });

    it('detects a local BT minimum (neg → pos slope) once', () => {
        // Decline then rise — classic charge TP shape
        const bt: number[] = [];
        for (let i = 0; i < 20; i++) bt.push(200 - i * 2); // cool
        for (let i = 0; i < 25; i++) bt.push(160 + i * 1.5); // heat
        const { xs } = axis(bt);

        const points = detectTurningPoints(xs, bt);
        expect(points.length).toBe(1);
        // min near transition (~ index 19–20)
        expect(points[0].timeSec).toBeGreaterThanOrEqual(15);
        expect(points[0].timeSec).toBeLessThanOrEqual(25);
        expect(points[0].temp).toBeLessThan(200);
    });

    it('returns empty on steadily rising curve (no TP)', () => {
        const bt = Array.from({ length: 40 }, (_, i) => 150 + i);
        expect(detectTurningPoints(axis(bt).xs, bt)).toEqual([]);
    });
});
