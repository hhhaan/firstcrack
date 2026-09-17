import { describe, expect, it } from 'vitest';
import { createAutoChargeDetector, type RawTemperatureSample } from './autoCharge';

const sample = (timestamp: number, bt: number): RawTemperatureSample => ({
    timestamp,
    bt,
    receivedAtMs: 1_000_000 + timestamp * 1000,
});

describe('automatic Charge', () => {
    it.each([500, 1000] as const)('detects 1 C/s onset at %ims, marking p3', (ms) => {
        const detector = createAutoChargeDetector('standard', ms);
        const period = ms / 1000;
        let hit = null;
        let detected = 0;
        for (let i = 0; i < 60; i++) {
            const t = i * period;
            hit = detector.push(sample(t, 200 - Math.max(0, t - 10)));
            if (hit) {
                detected = t;
                break;
            }
        }
        expect(detected).toBe(10 + 2 * period);
        expect(hit).toEqual(sample(10, 200));
    });
    it.each([0.999, 1, 1.001])('normalizes actual %ss intervals with nominal 1000ms parameters', (dt) => {
        const detector = createAutoChargeDetector('standard', 1000);
        const hits = Array.from({ length: 30 }, (_, i) =>
            detector.push(sample(i * dt, 200 - Math.max(0, i - 10) * dt)),
        );
        expect(hits[12]).toEqual(sample(10 * dt, 200));
    });
    it.each([500, 1000] as const)('rejects steady drift, noise and single spikes at %ims', (ms) => {
        for (const temperature of [
            (i: number) => 200 - i * 0.4,
            (i: number) => 200 + (i % 2) * 0.3,
            (i: number) => (i === 10 ? 170 : 200),
        ]) {
            const detector = createAutoChargeDetector('standard', ms);
            for (let i = 0; i < 60; i++) expect(detector.push(sample((i * ms) / 1000, temperature(i)))).toBeNull();
        }
    });
    it('uses p3 rather than the higher p2 and waits for six samples', () => {
        const detector = createAutoChargeDetector('standard', 1000);
        for (const [i, bt] of [200, 200, 200, 199, 198].entries()) expect(detector.push(sample(i, bt))).toBeNull();
        expect(detector.push(sample(5, 197))).toEqual(sample(3, 199));
    });
    it('uses eleven samples and marks index minus four for quantized wide-only detection', () => {
        const detector = createAutoChargeDetector('standard', 500);
        const values = [200, 200, 200, 200, 200, 200, 200, 200, 199, 199, 198];
        for (const [i, bt] of values.entries()) {
            expect(detector.push(sample(i / 2, bt))).toEqual(i === 10 ? sample(3, 200) : null);
        }
    });
    it('allows weak declines only in sensitive mode', () => {
        for (const mode of ['standard', 'sensitive'] as const) {
            const detector = createAutoChargeDetector(mode, 500);
            const hits = Array.from({ length: 20 }, (_, i) =>
                detector.push(sample(i / 2, 200 - 0.2 * Math.max(0, i - 10))),
            );
            expect(hits.some(Boolean)).toBe(mode === 'sensitive');
        }
    });
    it.each([0, 77])('does not charge at or below %i C', (base) => {
        const detector = createAutoChargeDetector('sensitive', 500);
        for (let i = 0; i < 20; i++) expect(detector.push(sample(i / 2, base - Math.max(0, i - 10)))).toBeNull();
    });
    it('ignores duplicate, reversed and burst timestamps without consuming the fall twice', () => {
        const detector = createAutoChargeDetector('standard', 1000);
        for (let i = 0; i <= 4; i++) detector.push(sample(i, 200));
        detector.push(sample(5, 199));
        for (const t of [5, 4, 5.1]) expect(detector.push(sample(t, 198))).toBeNull();
        expect(detector.push(sample(6, 198))).toEqual(sample(4, 200));
    });
    it.each([
        null,
        sample(6, NaN),
        sample(6, Infinity),
        sample(-1, 200),
        { ...sample(6, 200), receivedAtMs: 0 },
        sample(6, 400),
    ])('clears history on invalid sample %j', (bad) => {
        const detector = createAutoChargeDetector('standard', 1000);
        for (let i = 0; i <= 4; i++) detector.push(sample(i, 200));
        detector.push(sample(5, 199));
        expect(detector.push(bad)).toBeNull();
        expect(detector.push(sample(7, 198))).toBeNull();
    });
    it('clears history after extended gaps and explicit reset, allowing a restarted sensor clock', () => {
        const detector = createAutoChargeDetector('standard', 500);
        for (let i = 0; i <= 4; i++) detector.push(sample(i / 2, 200));
        expect(detector.push(sample(10, 195))).toBeNull();
        expect(detector.push(sample(10.5, 194))).toBeNull();
        detector.reset();
        const hits = [200, 200, 200, 200, 199, 198].map((bt, i) => detector.push(sample(i / 2, bt)));
        expect(hits[5]).toEqual(sample(1.5, 200));
    });
});
