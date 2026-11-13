import { describe, expect, it } from 'vitest';
import { resolveCurveColorCommit } from './shouldCommitCurveColor';

describe('resolveCurveColorCommit', () => {
    it('commits when the pick differs from stored and theme', () => {
        expect(resolveCurveColorCommit('#aabbcc', null, '#112233')).toEqual({ kind: 'set', color: '#aabbcc' });
    });

    it('skips when normalized pick matches stored', () => {
        expect(resolveCurveColorCommit('#AABBCC', '#aabbcc', '#112233')).toEqual({ kind: 'skip' });
    });

    it('skips when unset stored matches theme fallback', () => {
        expect(resolveCurveColorCommit('#112233', null, '#112233')).toEqual({ kind: 'skip' });
        expect(resolveCurveColorCommit('#112233', null, '#112233'.toUpperCase())).toEqual({ kind: 'skip' });
    });
});
