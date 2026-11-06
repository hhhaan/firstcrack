import { describe, expect, it } from 'vitest';

import { looksLikeReadOnlyFsError, shouldShowNotInApplicationsHint } from './updaterApplyErrors';

describe('looksLikeReadOnlyFsError', () => {
    it('detects common EROFS phrases', () => {
        expect(looksLikeReadOnlyFsError(new Error('Read-only file system (os error 30)'))).toBe(true);
        expect(looksLikeReadOnlyFsError(new Error('readonly file system'))).toBe(true);
        expect(looksLikeReadOnlyFsError(new Error('something erofs'))).toBe(true);
        expect(looksLikeReadOnlyFsError(new Error('random failure'))).toBe(false);
    });
});

describe('shouldShowNotInApplicationsHint', () => {
    it('shows hint only for EROFS-like errors when app is not known to be in Applications', () => {
        expect(shouldShowNotInApplicationsHint({ looksLikeEROFS: true, inApplications: false })).toBe(true);
        expect(shouldShowNotInApplicationsHint({ looksLikeEROFS: true, inApplications: null })).toBe(true);
        expect(shouldShowNotInApplicationsHint({ looksLikeEROFS: true, inApplications: true })).toBe(false);
        expect(shouldShowNotInApplicationsHint({ looksLikeEROFS: false, inApplications: false })).toBe(false);
    });
});
