import { describe, expect, it } from 'vitest';
import { createAutoChargeDetector, createAutoDropDetector, type RawTemperatureSample } from './autoCharge';

const processing = {
    algorithm_version: 'ema-least-squares-v1',
    temperature_unit: 'C',
    ror_unit: 'C/min',
    timestamp_clock: 'sidecar-monotonic-seconds',
    display_ema_alpha: 0.4,
    ror_ema_alpha: 0.3,
    ror_window_sec: 30,
    ror_warmup_reads: 3,
} as const;
const sample = (timestamp: number, bt: number): RawTemperatureSample => ({
    timestamp,
    sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
    bt,
    receivedAtMs: 1_000_000 + timestamp * 1000,
    processing,
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
        expect(detected).toBe(Math.max(12, 11 + 2 * period));
        expect(hit).toEqual(sample(10, 200));
    });
    it.each([0.999, 1, 1.001])('normalizes actual %ss intervals with nominal 1000ms parameters', (dt) => {
        const detector = createAutoChargeDetector('standard', 1000);
        const hits = Array.from({ length: 30 }, (_, i) =>
            detector.push(sample(i * dt, 200 - Math.max(0, i - 10) * dt)),
        );
        expect(hits.find(Boolean)).toEqual(sample(10 * dt, 200));
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
    it('preserves p3 through confirmation rather than using the higher p2', () => {
        const detector = createAutoChargeDetector('standard', 1000);
        for (const [i, bt] of [200, 200, 200, 199, 198].entries()) expect(detector.push(sample(i, bt))).toBeNull();
        expect(detector.push(sample(5, 197))).toBeNull();
        expect(detector.push(sample(6, 196))).toEqual(sample(3, 199));
    });
    it('uses eleven samples and marks index minus four for quantized wide-only detection', () => {
        const detector = createAutoChargeDetector('standard', 500);
        const values = [200, 200, 200, 200, 200, 200, 200, 200, 199, 199, 198, 198, 198];
        for (const [i, bt] of values.entries()) {
            expect(detector.push(sample(i / 2, bt))).toEqual(i === 12 ? sample(3, 200) : null);
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
        expect(detector.push(sample(6, 198))).toBeNull();
        expect(detector.push(sample(7, 197))).toEqual(sample(4, 200));
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
        const hits = [200, 200, 200, 200, 199, 198, 198, 198].map((bt, i) => detector.push(sample(i / 2, bt)));
        expect(hits[7]).toEqual(sample(1.5, 200));
    });
});

describe('automatic Drop', () => {
    it.each([500, 1000] as const)('detects a 0.35 C/s bend at %ims', (ms) => {
        const detector = createAutoDropDetector('standard', ms);
        const period = ms / 1000;
        let hit: RawTemperatureSample | null = null;
        for (let i = 0; i < 80; i++) {
            const t = i * period;
            hit = detector.push(sample(t, 200 - 0.35 * Math.max(0, t - 10)));
            if (hit) break;
        }
        expect(hit).toEqual(sample(10, 200));
    });
    it.each([500, 1000] as const)('detects 1 C/s onset at %ims, marking p3', (ms) => {
        const detector = createAutoDropDetector('standard', ms);
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
        expect(hit).toEqual(sample(10, 200));
        expect(detected).toBeGreaterThan(10 + 2 * period);
    });
    it.each([500, 1000] as const)('rejects steady drift, noise and single spikes at %ims', (ms) => {
        for (const temperature of [
            (i: number) => 200 - i * 0.4,
            (i: number) => 200 + (i % 2) * 0.3,
            (i: number) => (i === 10 ? 170 : 200),
        ]) {
            const detector = createAutoDropDetector('standard', ms);
            for (let i = 0; i < 60; i++) expect(detector.push(sample((i * ms) / 1000, temperature(i)))).toBeNull();
        }
    });
    it('uses p3 rather than the higher p2 and confirms on the next sample', () => {
        const detector = createAutoDropDetector('standard', 1000);
        for (const [i, bt] of [200, 200, 200, 199, 198, 197].entries()) expect(detector.push(sample(i, bt))).toBeNull();
        expect(detector.push(sample(6, 196))).toEqual(sample(3, 199));
    });
    it('uses eleven samples and confirms the wide-only mark on the next reading', () => {
        const detector = createAutoDropDetector('standard', 500);
        const values = [200, 200, 200, 200, 200, 200, 200, 200, 199, 199, 198, 198, 198];
        for (const [i, bt] of values.entries()) {
            expect(detector.push(sample(i / 2, bt))).toEqual(i === 12 ? sample(3, 200) : null);
        }
    });
    it('allows weak declines only in sensitive mode', () => {
        for (const mode of ['standard', 'sensitive'] as const) {
            const detector = createAutoDropDetector(mode, 500);
            const hits = Array.from({ length: 30 }, (_, i) =>
                detector.push(sample(i / 2, 200 - 0.1 * Math.max(0, i - 10))),
            );
            expect(hits.some(Boolean)).toBe(mode === 'sensitive');
        }
    });
    it.each([0, 77, 160])('does not drop at or below %i C', (base) => {
        const detector = createAutoDropDetector('sensitive', 500);
        for (let i = 0; i < 20; i++) expect(detector.push(sample(i / 2, base - Math.max(0, i - 10)))).toBeNull();
    });
    it('does not treat a Charge-temperature dump as Drop', () => {
        const detector = createAutoDropDetector('standard', 1000);
        for (let i = 0; i < 20; i++) expect(detector.push(sample(i, 90 - Math.max(0, i - 10)))).toBeNull();
    });
    it('does not drop on a 1 C transient dip that recovers (#459)', () => {
        const detector = createAutoDropDetector('standard', 1000);
        for (const [i, bt] of [200, 200, 200, 200, 199.5, 199, 200, 200].entries()) {
            expect(detector.push(sample(i, bt))).toBeNull();
        }
    });
    it('confirms a flat next sample when it does not recover', () => {
        const detector = createAutoDropDetector('standard', 1000);
        for (const [i, bt] of [200, 200, 200, 199, 198, 197].entries()) {
            expect(detector.push(sample(i, bt))).toBeNull();
        }
        expect(detector.push(sample(6, 197))).toEqual(sample(3, 199));
    });
    it('drops on a 200 to 170 step that then holds (#459)', () => {
        const detector = createAutoDropDetector('standard', 1000);
        for (let i = 0; i < 5; i++) expect(detector.push(sample(i, 200))).toBeNull();
        expect(detector.push(sample(5, 170))).toBeNull();
        expect(detector.push(sample(6, 170))).toEqual(sample(4, 200));
    });
});

describe('raw BT noise and rapid events', () => {
    it.each([500, 1000] as const)('rejects steady cooling at %ims, including rates above the old cap', (ms) => {
        for (const create of [createAutoChargeDetector, createAutoDropDetector]) {
            for (const rate of [1, 8]) {
                const detector = create('standard', ms);
                for (let i = 0; i < 20; i++) {
                    expect(detector.push(sample((i * ms) / 1000, 350 - (rate * i * ms) / 1000))).toBeNull();
                }
            }
        }
    });

    it('rejects a recoverable 1.4C Charge dip and a held 1C Drop dip', () => {
        for (const [create, values] of [
            [createAutoChargeDetector, [200, 200, 200, 200, 199.3, 198.6, 200]],
            [createAutoDropDetector, [200, 200, 200, 200, 199.5, 199, 199, 200]],
        ] as const) {
            const detector = create('standard', 1000);
            for (const [i, bt] of values.entries()) expect(detector.push(sample(i, bt))).toBeNull();
        }
    });

    it.each([500, 1000] as const)('confirms a rapid real step through the temperature floor at %ims', (ms) => {
        for (const create of [createAutoChargeDetector, createAutoDropDetector]) {
            const detector = create('standard', ms);
            const values = [200, 200, 200, 200, 200, 170, 150, 145, 140, 135, 130, 125];
            const hits = values.map((bt, i) => detector.push(sample((i * ms) / 1000, bt)));
            expect(hits.find(Boolean)).toEqual(sample((4 * ms) / 1000, 200));
        }
    });

    it.each([500, 1000] as const)('does not confirm a rapid step that recovers at %ims', (ms) => {
        for (const create of [createAutoChargeDetector, createAutoDropDetector]) {
            const detector = create('standard', ms);
            for (const [i, bt] of [200, 200, 200, 200, 170, 200, 200, 200].entries()) {
                expect(detector.push(sample((i * ms) / 1000, bt))).toBeNull();
            }
        }
    });
});

it('cancels a candidate recovering from its newest low during confirmation', () => {
    for (const create of [createAutoChargeDetector, createAutoDropDetector]) {
        const detector = create('standard', 500);
        for (const [i, bt] of [200, 200, 200, 200, 199, 198, 197, 197.6, 200].entries()) {
            expect(detector.push(sample(i / 2, bt))).toBeNull();
        }
    }
});
