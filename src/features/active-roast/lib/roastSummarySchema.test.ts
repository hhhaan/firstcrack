import { describe, expect, it } from 'vitest';
import { buildRoastSummarySchema, type RoastSummaryForm } from './roastSummarySchema';

/** Identity translator — assertions match on the key so no locale file is loaded. */
const schema = buildRoastSummarySchema({ t: (key) => key, hasHandoff: false });

const form = (overrides: Partial<RoastSummaryForm> = {}): RoastSummaryForm => ({
    notes: '',
    weightGrams: 12,
    outputWeightKg: undefined,
    roastLevel: null,
    beanId: 'bean-1',
    beanLabel: '',
    linkMode: 'none',
    planBatchId: null,
    deductStock: false,
    ...overrides,
});

const issuesFor = (data: RoastSummaryForm) => {
    const result = schema.safeParse(data);
    return result.success ? [] : result.error.issues;
};

describe('buildRoastSummarySchema weight bounds', () => {
    it('rejects a green weight above the batch ceiling', () => {
        const issues = issuesFor(form({ weightGrams: 501 }));
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual(['weightGrams']);
        expect(issues[0].message).toBe('activeRoast.summary.weightTooLarge');
    });

    it('rejects an output weight above the batch ceiling', () => {
        const issues = issuesFor(form({ weightGrams: 500, outputWeightKg: 501 }));
        expect(issues.some((i) => i.message === 'activeRoast.summary.weightTooLarge')).toBe(true);
    });

    it('accepts a weight exactly at the ceiling', () => {
        expect(issuesFor(form({ weightGrams: 500 }))).toEqual([]);
    });
});

describe('buildRoastSummarySchema output vs input', () => {
    it('rejects output greater than input', () => {
        const issues = issuesFor(form({ weightGrams: 12, outputWeightKg: 13 }));
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual(['outputWeightKg']);
        expect(issues[0].message).toBe('activeRoast.summary.outputExceedsInput');
    });

    // weight 0 is the modal default; the DB check rejects 0 < output with 23514.
    it('rejects output entered while green weight is still zero', () => {
        const issues = issuesFor(form({ weightGrams: 0, outputWeightKg: 5 }));
        expect(issues).toHaveLength(1);
        expect(issues[0].message).toBe('activeRoast.summary.outputExceedsInput');
    });

    it('accepts output equal to input', () => {
        expect(issuesFor(form({ weightGrams: 12, outputWeightKg: 12 }))).toEqual([]);
    });

    it('accepts a normal loss', () => {
        expect(issuesFor(form({ weightGrams: 12, outputWeightKg: 10 }))).toEqual([]);
    });

    // Blank number input yields NaN — "not weighed", not invalid.
    it('accepts NaN output', () => {
        expect(issuesFor(form({ outputWeightKg: Number.NaN }))).toEqual([]);
    });

    it('accepts omitted output', () => {
        expect(issuesFor(form({ outputWeightKg: undefined }))).toEqual([]);
    });
});

describe('buildRoastSummarySchema roast color', () => {
    it('accepts a blank color', () => {
        expect(issuesFor(form({ colorWhole: '', colorGround: undefined }))).toEqual([]);
    });

    it('accepts free-text color strings', () => {
        expect(
            issuesFor(
                form({
                    colorWhole: '58.4, 58.7, 59.0',
                    colorGround: 'WB 58.4 (avg)',
                }),
            ),
        ).toEqual([]);
    });

    it('rejects color text over the max length', () => {
        const issues = issuesFor(form({ colorGround: 'x'.repeat(121) }));
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual(['colorGround']);
    });
});

describe('buildRoastSummarySchema existing refinements', () => {
    it('still requires a bean name when weight is set', () => {
        const issues = issuesFor(form({ beanId: null, beanLabel: '  ' }));
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual(['beanLabel']);
        expect(issues[0].message).toBe('activeRoast.summary.beanRequired');
    });

    it('still requires a batch when linking to the schedule', () => {
        const issues = issuesFor(form({ linkMode: 'schedule', planBatchId: null }));
        expect(issues).toHaveLength(1);
        expect(issues[0].path).toEqual(['planBatchId']);
    });

    it('skips link refinements under a handoff but keeps the weight cross-check', () => {
        const handoffSchema = buildRoastSummarySchema({ t: (key) => key, hasHandoff: true });
        expect(handoffSchema.safeParse(form({ linkMode: 'schedule', planBatchId: null })).success).toBe(true);
        expect(handoffSchema.safeParse(form({ weightGrams: 12, outputWeightKg: 13 })).success).toBe(false);
    });
});
