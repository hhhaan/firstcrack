import { describe, expect, it } from 'vitest';
import { roastProfilePatch } from './roast-profile-patch';

describe('roastProfilePatch', () => {
    it('writes the profile chosen in the form', () => {
        expect(roastProfilePatch('prof-1', 'old', false)).toEqual({ roast_profile_id: 'prof-1' });
    });

    it('writes null when the user cleared the selection', () => {
        expect(roastProfilePatch(null, 'prof-1', false)).toEqual({ roast_profile_id: null });
    });

    it('keeps the batch profile when the control is blank and was not cleared', () => {
        expect(roastProfilePatch(null, 'prof-1', true)).toEqual({ roast_profile_id: 'prof-1' });
    });

    it('omits the column when neither the form nor the batch has a profile', () => {
        expect(roastProfilePatch(null, null, true)).toEqual({});
    });
});
