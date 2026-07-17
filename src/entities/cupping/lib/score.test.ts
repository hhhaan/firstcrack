import { describe, expect, it } from 'vitest';
import {
    defaultScaV1Scores,
    isValidScoreStep,
    normalizeDescriptors,
    parseScaV1Scores,
    SCA_V1_BASE,
    SCORE_MAX,
    SCORE_MIN,
    totalScoreScaV1,
} from './score';

describe('totalScoreScaV1', () => {
    it('sums base + attributes - defects', () => {
        const scores = defaultScaV1Scores(8);
        // 8 attributes * 8 = 64 + 36 = 100
        expect(totalScoreScaV1(scores, 0)).toBe(SCA_V1_BASE + 64);
        expect(totalScoreScaV1(scores, 2)).toBe(SCA_V1_BASE + 64 - 4);
    });

    it('treats negative defects as zero penalty', () => {
        const scores = defaultScaV1Scores(6);
        expect(totalScoreScaV1(scores, -3)).toBe(totalScoreScaV1(scores, 0));
    });
});

describe('isValidScoreStep', () => {
    it('accepts 0.25 steps within range', () => {
        expect(isValidScoreStep(7.5)).toBe(true);
        expect(isValidScoreStep(SCORE_MIN)).toBe(true);
        expect(isValidScoreStep(SCORE_MAX)).toBe(true);
        expect(isValidScoreStep(7.1)).toBe(false);
        expect(isValidScoreStep(11)).toBe(false);
        expect(isValidScoreStep(-0.25)).toBe(false);
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

    it('rejects missing keys', () => {
        expect(() => parseScaV1Scores({ fragrance: 6 })).toThrow();
    });
});

describe('normalizeDescriptors', () => {
    it('lowercases, trims, dedupes, caps at 20', () => {
        expect(normalizeDescriptors([' Citrus ', 'citrus', 'Honey'])).toEqual(['citrus', 'honey']);
        const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
        expect(normalizeDescriptors(many)).toHaveLength(20);
    });

    it('returns empty for non-arrays', () => {
        expect(normalizeDescriptors(null)).toEqual([]);
        expect(normalizeDescriptors('citrus')).toEqual([]);
    });
});
