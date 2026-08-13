import { describe, expect, it } from 'vitest';
import { buildRoastSummarySchema, MAX_BATCH_WEIGHT_KG } from './roastSummarySchema';

const t = (key: string) => key;

const valid = {
    notes: '',
    weightGrams: 12,
    outputWeightKg: 10,
    roastLevel: null,
    beanId: 'bean-1',
    beanLabel: '',
    linkMode: 'none' as const,
    planBatchId: null,
    deductStock: false,
};

const parse = (over: Partial<typeof valid>, hasHandoff = false) =>
    buildRoastSummarySchema(t, hasHandoff).safeParse({ ...valid, ...over });

const issuePaths = (result: ReturnType<typeof parse>) =>
    result.success ? [] : result.error.issues.map((i) => i.path[0]);

describe('buildRoastSummarySchema', () => {
    it('rejects extra-zero weight typo above MAX_BATCH_WEIGHT_KG', () => {
        const result = parse({ weightGrams: 1200 });
        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('weightGrams');
        expect(1200).toBeGreaterThan(MAX_BATCH_WEIGHT_KG);
    });

    it('rejects weightGrams at 501 (above 500kg cap)', () => {
        const result = parse({ weightGrams: 501 });
        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('weightGrams');
    });

    it('rejects output greater than input', () => {
        const result = parse({ weightGrams: 12, outputWeightKg: 13 });
        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('outputWeightKg');
    });

    it('accepts output equal to input', () => {
        expect(parse({ weightGrams: 12, outputWeightKg: 12 }).success).toBe(true);
    });

    it('accepts blank output (NaN)', () => {
        expect(parse({ outputWeightKg: Number.NaN }).success).toBe(true);
    });
});
