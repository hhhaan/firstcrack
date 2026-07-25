import { describe, expect, it } from 'vitest';
import { detectTurningPoints } from './turningPoints';

/** Build monotonic time axis 0..n-1 sec with given BT series. */
const axis = (bt: number[]) => ({
    xs: bt.map((_, i) => i),
    bt,
});

describe('detectTurningPoints', () => {
    it('returns empty before 20s post-charge floor', () => {
        const bt = Array.from({ length: 10 }, (_, i) => 200 - i);
        expect(detectTurningPoints(axis(bt).xs, bt)).toEqual([]);
    });

    it('detects a local BT minimum (decline → rise) once', () => {
        const bt: number[] = [];
        for (let i = 0; i < 20; i++) bt.push(200 - i * 5); // cool to 105
        for (let i = 0; i < 25; i++) bt.push(105 + i * 1.5); // heat
        const { xs } = axis(bt);

        const points = detectTurningPoints(xs, bt);
        expect(points.length).toBe(1);
        // global-min rescan pins the exact valley (index 19–20)
        expect(points[0].timeSec).toBeGreaterThanOrEqual(15);
        expect(points[0].timeSec).toBeLessThanOrEqual(25);
        expect(points[0].temp).toBeLessThan(110);
    });

    it('returns empty on steadily rising curve (min = charge temp, out of TP sanity range)', () => {
        const bt = Array.from({ length: 40 }, (_, i) => 150 + i);
        expect(detectTurningPoints(axis(bt).xs, bt)).toEqual([]);
    });

    it('detects TP on realistic gentle curvature at 500ms sampling (no noise)', () => {
        // BT(t) = 95 + 110·e^(-t/30) + 0.18t → TP ≈ 90s
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

    it('rejects spurious early upcross (hot-drum noise bump) and finds the real TP', () => {
        // 뜨거운 드럼 투입: 210°C 급락 초기 t≈2~5s에 +3°C 노이즈 범프.
        // 20s floor 미달이라 발화 불가 — 진짜 TP(~73s)만 잡아야 한다
        const xs: number[] = [];
        const bt: number[] = [];
        for (let t = 0; t < 2; t += 0.5) {
            xs.push(t);
            bt.push(210 - 5 * t);
        }
        for (let t = 2; t < 5; t += 0.5) {
            xs.push(t);
            bt.push(200 + (t - 2));
        }
        for (let t = 5; t <= 200; t += 0.5) {
            xs.push(t);
            bt.push(95 + 108 * Math.exp(-(t - 5) / 20) + 0.18 * (t - 5));
        }
        const points = detectTurningPoints(xs, bt);
        expect(points.length).toBe(1);
        expect(points[0].timeSec).toBeGreaterThanOrEqual(55);
        expect(points[0].timeSec).toBeLessThanOrEqual(90);
        expect(points[0].temp).toBeLessThan(130);
    });

    it('noise breaking monotonicity only delays the trigger — rescan still pins the true TP', () => {
        // TP≈60s. 상승 구간 t=70~71s에 -1°C 딥 → 그 구간에선 발화 억제,
        // 딥이 지나가면 발화하고 전역 최솟값 재스캔이 진짜 TP를 복원해야 한다
        const xs: number[] = [];
        const bt: number[] = [];
        for (let t = 0; t <= 120; t += 0.5) {
            xs.push(t);
            let v = 90 + 95 * Math.exp(-t / 20) + 0.18 * t;
            if (t >= 70 && t <= 71) v -= 1;
            bt.push(v);
        }
        // 딥 한복판까지만 잘라서 호출 → 단조성 깨짐 → 미발화
        const cut = xs.findIndex((t) => t > 70.5);
        expect(detectTurningPoints(xs.slice(0, cut), bt.slice(0, cut))).toEqual([]);
        // 전체 시리즈 → 발화 + 정확한 TP
        const points = detectTurningPoints(xs, bt);
        expect(points.length).toBe(1);
        expect(points[0].timeSec).toBeGreaterThanOrEqual(50);
        expect(points[0].timeSec).toBeLessThanOrEqual(75);
    });

    it('rejects TP outside sanity range (shallow hot-drum valley above 150°C)', () => {
        const xs: number[] = [];
        const bt: number[] = [];
        for (let t = 0; t <= 100; t += 0.5) {
            xs.push(t);
            // 210 → 160 골짜기(t≈40) → 상승: 최솟값 160 > 150 → 기각
            bt.push(160 + 50 * Math.exp(-t / 15) + 0.2 * Math.max(0, t - 40));
        }
        expect(detectTurningPoints(xs, bt)).toEqual([]);
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
