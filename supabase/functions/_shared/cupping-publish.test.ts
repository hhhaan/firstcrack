import { describe, expect, it } from 'vitest';
import { normalizeCuppedBy, parseInviteAction, parsePublishSamples } from './cupping-publish.ts';

describe('normalizeCuppedBy', () => {
    it('trims and falls back to Anonymous', () => {
        expect(normalizeCuppedBy('  Minji  ')).toBe('Minji');
        expect(normalizeCuppedBy('')).toBe('Anonymous');
        expect(normalizeCuppedBy(null)).toBe('Anonymous');
    });

    it('caps at 80 chars', () => {
        expect(normalizeCuppedBy('x'.repeat(90))).toHaveLength(80);
    });
});

describe('parseInviteAction', () => {
    it('defaults to legacy', () => {
        expect(parseInviteAction(undefined)).toBe('legacy');
        expect(parseInviteAction('claim')).toBe('claim');
        expect(parseInviteAction('publish')).toBe('publish');
    });

    it('rejects unknown actions', () => {
        expect(() => parseInviteAction('sync')).toThrow('invalid action');
    });
});

describe('parsePublishSamples', () => {
    it('requires a non-empty unique list', () => {
        expect(() => parsePublishSamples([])).toThrow('samples required');
        expect(() => parsePublishSamples(null)).toThrow('samples required');
        expect(() =>
            parsePublishSamples([
                { sampleId: 'a', scores: {} },
                { sampleId: 'a', scores: {} },
            ]),
        ).toThrow('duplicate sample');
    });

    it('normalizes defects, notes, descriptors', () => {
        expect(
            parsePublishSamples([
                {
                    sampleId: ' s1 ',
                    scores: { flavor: 8 },
                    defects: 2,
                    notes: 'ok',
                    descriptors: ['Citrus', 'citrus', ''],
                },
            ]),
        ).toEqual([
            {
                sampleId: 's1',
                scores: { flavor: 8 },
                defects: 2,
                notes: 'ok',
                descriptors: ['citrus'],
            },
        ]);
    });
});
