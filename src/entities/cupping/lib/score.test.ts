import { describe, expect, it } from 'vitest';
import { defaultScaV1Scores, isValidScoreStep, parseScaV1Scores, SCA_V1_BASE, totalScoreScaV1 } from './score';

describe('totalScoreScaV1', () => {
    it('sums base + attributes - defects', () => {
        const scores = defaultScaV1Scores(8);
        // 8 attributes * 8 = 64 + 36 = 100
        expect(totalScoreScaV1(scores, 0)).toBe(SCA_V1_BASE + 64);
        expect(totalScoreScaV1(scores, 2)).toBe(SCA_V1_BASE + 64 - 4);
    });
});

describe('isValidScoreStep', () => {
    it('accepts 0.25 steps', () => {
        expect(isValidScoreStep(7.5)).toBe(true);
        expect(isValidScoreStep(0)).toBe(true);
        expect(isValidScoreStep(10)).toBe(true);
        expect(isValidScoreStep(7.1)).toBe(false);
        expect(isValidScoreStep(11)).toBe(false);
    });
});

describe('parseScaV1Scores', () => {
    it('parses valid scores', () => {
        const s = parseScaV1Scores(defaultScaV1Scores(6.25));
        expect(s.fragrance).toBe(6.25);
    });

    it('rejects invalid step', () => {
        expect(() => parseScaV1Scores({ ...defaultScaV1Scores(6), fragrance: 6.1 })).toThrow();
    });
});
