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

    it('detects TP on realistic gentle curvature at 500ms sampling (no noise)', () => {
        // BT(t) = 95 + 110·e^(-t/30) + 0.18t → TP ≈ 90s, curvature ~0.006 °C/s²
        // 미분이 ±0.01 데드존에 ~7샘플 머무는 실측 유사 곡선
        const xs: number[] = [];
        const bt: number[] = [];
        for (let t = 0; t <= 300; t += 0.5) {
            xs.push(t);
            bt.push(95 + 110 * Math.exp(-t / 30) + 0.18 * t);
        }
        const points = detectTurningPoints(xs, bt);
        expect(points.length).toBe(1);
        expect(points[0].timeSec).toBeGreaterThanOrEqual(75);
        expect(points[0].timeSec).toBeLessThanOrEqual(105);
    });

    it('ignores pre-charge dip (negative time) and finds post-charge TP', () => {
        const xs: number[] = [];
        const bt: number[] = [];
        // pre-charge: 완만한 딥 후 상승 (가스 조정 등) — TP로 오인하면 안 됨
        for (let t = -30; t < 0; t += 0.5) {
            xs.push(t);
            bt.push(180 + 0.02 * (t + 15) * (t + 15));
        }
        // post-charge: 급락 후 TP≈60s
        for (let t = 0; t <= 200; t += 0.5) {
            xs.push(t);
            bt.push(90 + 95 * Math.exp(-t / 20) + 0.18 * t);
        }
        const points = detectTurningPoints(xs, bt);
        expect(points.length).toBe(1);
        expect(points[0].timeSec).toBeGreaterThan(0);
    });
});
