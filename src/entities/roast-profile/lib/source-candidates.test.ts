import { describe, expect, it } from 'vitest';
import { profileSourceCandidates } from './source-candidates';

const beans = [
    { id: 'b1', name: 'Single' },
    { id: 'b2', name: 'Other' },
];
const blends = [{ id: 'x1', name: 'Modern' }];
describe('profile source candidates', () => {
    it('treats a whole blend as one candidate and deduplicates registration and history', () => {
        expect(
            profileSourceCandidates(
                { default_bean_id: null, default_blend_id: 'x1', sources: [{ bean_id: null, blend_id: 'x1' }] },
                [{ bean_id: null, blend_id: 'x1' }],
                beans,
                blends,
            ),
        ).toEqual([{ beanId: null, blendId: 'x1', name: 'Modern' }]);
    });
    it('combines multiple registrations and history; removes deleted inventory ids', () => {
        expect(
            profileSourceCandidates(
                { default_bean_id: 'b1', default_blend_id: null, sources: [{ bean_id: null, blend_id: 'x1' }] },
                [
                    { bean_id: 'b2', blend_id: null },
                    { bean_id: 'deleted', blend_id: null },
                ],
                beans,
                blends,
            ),
        ).toEqual([
            { beanId: null, blendId: 'x1', name: 'Modern' },
            { beanId: 'b1', blendId: null, name: 'Single' },
            { beanId: 'b2', blendId: null, name: 'Other' },
        ]);
    });
    it('does not suggest history without a selected profile', () => {
        expect(profileSourceCandidates(null, [{ bean_id: 'b1', blend_id: null }], beans, blends)).toEqual([]);
    });
});
