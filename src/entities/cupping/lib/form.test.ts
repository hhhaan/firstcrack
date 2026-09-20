import { describe, expect, it } from 'vitest';
import {
    clampFieldScore,
    cloneForm,
    defaultScoresForForm,
    formSchemaOrSca,
    isSliderField,
    parseFormSchema,
    parseScoresForForm,
    SCA_V1_FORM,
    SIMPLE_5_FORM,
    slugFieldKey,
    tallyChoiceFields,
    totalScoreForForm,
} from './form';
import { SCA_V1_BASE, totalScoreScaV1 } from './score';

describe('SCA_V1_FORM', () => {
    it('matches classic total', () => {
        const scores = defaultScoresForForm(SCA_V1_FORM, 8);
        expect(totalScoreForForm(SCA_V1_FORM, scores, 0)).toBe(SCA_V1_BASE + 64);
        expect(totalScoreForForm(SCA_V1_FORM, scores, 0)).toBe(totalScoreScaV1(scores, 0));
    });
});

describe('SIMPLE_5_FORM', () => {
    it('sums five attributes with no base', () => {
        const scores = defaultScoresForForm(SIMPLE_5_FORM, 8);
        expect(totalScoreForForm(SIMPLE_5_FORM, scores, 0)).toBe(40);
        expect(totalScoreForForm(SIMPLE_5_FORM, scores, 1)).toBe(38);
    });
});

describe('parseFormSchema', () => {
    it('round-trips presets', () => {
        expect(parseFormSchema(SCA_V1_FORM)).toEqual(SCA_V1_FORM);
        expect(parseFormSchema(SIMPLE_5_FORM)).toEqual(SIMPLE_5_FORM);
    });

    it('rejects empty fields', () => {
        expect(() => parseFormSchema({ ...SCA_V1_FORM, fields: [] })).toThrow();
    });

    it('formSchemaOrSca falls back', () => {
        expect(formSchemaOrSca(null)).toEqual(SCA_V1_FORM);
        expect(formSchemaOrSca({ v: 9 })).toEqual(SCA_V1_FORM);
    });
});

describe('parseScoresForForm', () => {
    it('rejects missing custom keys', () => {
        const custom = cloneForm(SIMPLE_5_FORM, 'QC');
        expect(() => parseScoresForForm(custom, { fragrance: 6 })).toThrow(/flavor/);
    });
});

describe('mixed field types', () => {
    const qc = parseFormSchema({
        v: 1,
        key: 'custom',
        name: 'QC',
        fields: [
            { key: 'flavor', label: 'Flavor', type: 'slider', min: 0, max: 5, step: 1 },
            { key: 'clean', label: 'Clean', type: 'pass_fail' },
            { key: 'grade', label: 'Grade', type: 'select', options: ['A', 'B', 'C'] },
        ],
        scoring: { base: 0, defectWeight: 2 },
    });

    it('parses 0–5 + pass/fail + select', () => {
        const scores = parseScoresForForm(qc, { flavor: 4, clean: 1, grade: 'B' });
        expect(scores).toEqual({ flavor: 4, clean: 1, grade: 'B' });
        expect(totalScoreForForm(qc, scores, 0)).toBe(4);
    });

    it('pass/fail and select are not added to total', () => {
        expect(totalScoreForForm(qc, { flavor: 3, clean: 1, grade: 'A' }, 0)).toBe(3);
        expect(totalScoreForForm(qc, { flavor: 3, clean: 0, grade: 'C' }, 0)).toBe(3);
    });

    it('legacy slider without type still parses', () => {
        const legacy = parseFormSchema({
            ...SIMPLE_5_FORM,
            fields: SIMPLE_5_FORM.fields.map(({ type: _t, ...rest }) => rest),
        });
        expect(legacy.fields.every((f) => (f.type ?? 'slider') === 'slider')).toBe(true);
    });
});

describe('clampFieldScore', () => {
    it('snaps to step', () => {
        const f = SCA_V1_FORM.fields[0];
        expect(isSliderField(f)).toBe(true);
        if (!isSliderField(f)) return;
        expect(clampFieldScore(7.1, f)).toBe(7);
        expect(clampFieldScore(7.2, f)).toBe(7.25);
    });
});

describe('tallyChoiceFields', () => {
    const qc = parseFormSchema({
        v: 1,
        key: 'custom',
        name: 'QC',
        fields: [
            { key: 'flavor', label: 'Flavor', type: 'slider', min: 0, max: 5, step: 1 },
            { key: 'clean', label: 'Clean', type: 'pass_fail' },
        ],
        scoring: { base: 0, defectWeight: 2 },
    });

    it('counts pass and fail per user row', () => {
        const tallies = tallyChoiceFields(qc, [
            { scores: { flavor: 4, clean: 1 } },
            { scores: { flavor: 3, clean: 1 } },
            { scores: { flavor: 2, clean: 0 } },
        ]);
        expect(tallies).toEqual([
            {
                key: 'clean',
                label: 'Clean',
                type: 'pass_fail',
                counts: [
                    { value: 'Pass', count: 2 },
                    { value: 'Fail', count: 1 },
                ],
            },
        ]);
    });
});

describe('slugFieldKey', () => {
    it('ascii from label and avoids collisions', () => {
        const used = new Set(['sweetness']);
        expect(slugFieldKey('Sweetness', used)).toBe('sweetness_2');
        expect(slugFieldKey('향', new Set())).toBe('field');
    });
});
