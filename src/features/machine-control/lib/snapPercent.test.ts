import { describe, expect, it } from 'vitest';
import { isPercentUnit, percentTicks, showLiveFollow, snapPercent, stepPercent } from './snapPercent';

describe('snapPercent', () => {
    it('5% 단위로 반올림한다', () => {
        expect(snapPercent(73)).toBe(75);
        expect(snapPercent(72)).toBe(70);
        expect(snapPercent(0)).toBe(0);
        expect(snapPercent(100)).toBe(100);
    });

    it('min/max로 자른다', () => {
        expect(snapPercent(120, 0, 100)).toBe(100);
        expect(snapPercent(-4, 0, 100)).toBe(0);
        expect(snapPercent(-4, 1, 100)).toBe(1);
    });
});

describe('stepPercent', () => {
    it('±5 후 5%로 스냅한다', () => {
        expect(stepPercent(70, 5)).toBe(75);
        expect(stepPercent(70, -5)).toBe(65);
        expect(stepPercent(73, 5)).toBe(80);
        expect(stepPercent(73, -5)).toBe(70);
    });

    it('범위 끝에서 멈춘다', () => {
        expect(stepPercent(98, 5)).toBe(100);
        expect(stepPercent(2, -5, 1, 100)).toBe(1);
    });
});

describe('isPercentUnit', () => {
    it('% 채널만 세로 눈금 대상이다', () => {
        expect(isPercentUnit('%')).toBe(true);
        expect(isPercentUnit(undefined)).toBe(true);
        expect(isPercentUnit('step')).toBe(false);
    });
});

describe('percentTicks', () => {
    it('0–100을 5 간격으로 만든다', () => {
        const ticks = percentTicks(0, 100);
        expect(ticks[0]).toBe(0);
        expect(ticks[1]).toBe(5);
        expect(ticks[ticks.length - 1]).toBe(100);
        expect(ticks).toHaveLength(21);
    });

    it('min이 5의 배수가 아니면 min을 포함한다', () => {
        expect(percentTicks(1, 100)[0]).toBe(1);
        expect(percentTicks(1, 100)).toContain(5);
    });
});

describe('showLiveFollow', () => {
    it('지시가 있고 실측이 1 넘게 벌어져 있을 때만 산다', () => {
        expect(showLiveFollow(70, 65, 1)).toBe(true);
        expect(showLiveFollow(70, 69, 1)).toBe(false);
        expect(showLiveFollow(70, 70, 1)).toBe(false);
        expect(showLiveFollow(undefined, 65, 1)).toBe(false);
        expect(showLiveFollow(70, null, 1)).toBe(false);
    });
});
