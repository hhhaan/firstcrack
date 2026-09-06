import { describe, expect, it } from 'vitest';
import {
    buildTargetDeltaMarkPoint,
    classifyTargetDelta,
    formatTargetDeltaLabel,
    nearestBtAt,
} from './target-delta-label';

const colors = { within: '#within', over: '#over', under: '#under' };

describe('nearestBtAt', () => {
    it('picks the closest non-null sample', () => {
        expect(nearestBtAt([], [], 10)).toBeNull();
        expect(nearestBtAt([0, 5, 10], [100, null, 120], 6)).toBe(120);
        expect(nearestBtAt([0, 5, 10], [100, 110, 120], 4)).toBe(110);
    });
});

describe('formatTargetDeltaLabel', () => {
    it('formats positive and negative', () => {
        expect(formatTargetDeltaLabel(2.3)).toBe('+2.3°');
        expect(formatTargetDeltaLabel(-1)).toBe('−1.0°');
        expect(formatTargetDeltaLabel(0)).toBe('+0.0°');
    });
});

describe('classifyTargetDelta', () => {
    it('uses ±2°C band', () => {
        expect(classifyTargetDelta(1, 'C')).toBe('within');
        expect(classifyTargetDelta(3, 'C')).toBe('over');
        expect(classifyTargetDelta(-3, 'C')).toBe('under');
    });

    it('converts °F delta to °C for band', () => {
        // 3.6°F ≈ 2°C → edge of within
        expect(classifyTargetDelta(3.6, 'F')).toBe('within');
        expect(classifyTargetDelta(5.4, 'F')).toBe('over'); // 3°C
    });
});

describe('buildTargetDeltaMarkPoint', () => {
    const xs = [0, 30, 60];
    const btActual = [200, 191, 180];
    const targetXs = [0, 60];
    const targetBt = [200, 180]; // at 30s target = 190

    it('returns null when disabled or not charged', () => {
        expect(
            buildTargetDeltaMarkPoint({
                show: false,
                charged: true,
                currentTimeSec: 30,
                xs,
                btActual,
                targetXs,
                targetBt,
                temperatureUnit: 'C',
                colors,
            }),
        ).toBeNull();
        expect(
            buildTargetDeltaMarkPoint({
                show: true,
                charged: false,
                currentTimeSec: 30,
                xs,
                btActual,
                targetXs,
                targetBt,
                temperatureUnit: 'C',
                colors,
            }),
        ).toBeNull();
    });

    it('returns null without target series', () => {
        expect(
            buildTargetDeltaMarkPoint({
                show: true,
                charged: true,
                currentTimeSec: 30,
                xs,
                btActual,
                targetXs: [],
                targetBt: [],
                temperatureUnit: 'C',
                colors,
            }),
        ).toBeNull();
    });

    it('places label at mid y with signed delta', () => {
        const mp = buildTargetDeltaMarkPoint({
            show: true,
            charged: true,
            currentTimeSec: 30,
            xs,
            btActual,
            targetXs,
            targetBt,
            temperatureUnit: 'C',
            colors,
        }) as { coord: [number, number]; label: { formatter: string; color: string } };

        expect(mp).not.toBeNull();
        // BT 191, target 190 → delta +1, mid 190.5
        expect(mp.coord[0]).toBe(30);
        expect(mp.coord[1]).toBeCloseTo(190.5);
        expect(mp.label.formatter).toBe('+1.0°');
        expect(mp.label.color).toBe('#within');
    });

    it('colors over when beyond band', () => {
        const mp = buildTargetDeltaMarkPoint({
            show: true,
            charged: true,
            currentTimeSec: 30,
            xs,
            btActual: [200, 195, 180],
            targetXs,
            targetBt,
            temperatureUnit: 'C',
            colors,
        }) as { label: { formatter: string; color: string } };

        expect(mp.label.formatter).toBe('+5.0°');
        expect(mp.label.color).toBe('#over');
    });
});
