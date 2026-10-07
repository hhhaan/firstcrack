import { describe, expect, it } from 'vitest';
import { resolveCurveColorCommit, shouldCommitCurveColor } from './shouldCommitCurveColor';

describe('shouldCommitCurveColor', () => {
    it('commits a new custom color when stored is null', () => {
        expect(shouldCommitCurveColor('#aabbcc', null, '#112233')).toBe(true);
    });

    it('does not commit when stored already matches (case-insensitive)', () => {
        expect(shouldCommitCurveColor('#AABBCC', '#aabbcc', '#112233')).toBe(false);
    });

    it('does not commit theme fallback when stored is null', () => {
        expect(shouldCommitCurveColor('#112233', null, '#112233')).toBe(false);
        expect(shouldCommitCurveColor('#112233', null, '#112233'.toUpperCase())).toBe(false);
    });
});

describe('resolveCurveColorCommit', () => {
    it('clears stored custom color when the user picks the current theme hex', () => {
        expect(resolveCurveColorCommit('#112233', '#ff0000', '#112233')).toEqual({ kind: 'set', color: null });
        expect(resolveCurveColorCommit('#112233', '#ff0000', '#112233'.toUpperCase())).toEqual({
            kind: 'set',
            color: null,
        });
    });
});
