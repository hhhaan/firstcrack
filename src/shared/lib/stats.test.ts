import { describe, expect, it } from 'vitest';
import { mean, outlierIndices, stddev } from './stats';

describe('mean', () => {
    it('averages values', () => {
        expect(mean([1, 2, 3])).toBe(2);
    });
    it('returns null for empty input', () => {
        expect(mean([])).toBeNull();
    });
});

describe('stddev', () => {
    it('computes sample standard deviation', () => {
        expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    });
    it('returns null below 2 values', () => {
        expect(stddev([])).toBeNull();
        expect(stddev([5])).toBeNull();
    });
    it('returns 0 for identical values', () => {
        expect(stddev([3, 3, 3])).toBe(0);
    });
});

describe('outlierIndices', () => {
    it('flags values beyond 2 sigma', () => {
        const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 30];
        expect(outlierIndices(values)).toEqual([9]);
    });
    it('returns empty when sigma is 0 or undefined', () => {
        expect(outlierIndices([5, 5, 5])).toEqual([]);
        expect(outlierIndices([5])).toEqual([]);
    });
});
