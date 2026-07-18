import { describe, expect, it } from 'vitest';
import { mapInviteError } from './mapInviteError';

// TDD red: mapInviteError.ts 구현 전. 계약은 docs/team-workspaces.md 2a의 RPC RAISE 코드.
describe('mapInviteError', () => {
    it('maps RPC raise codes from postgrest error message', () => {
        expect(mapInviteError(new Error('invite_expired'))).toBe('expired');
        expect(mapInviteError({ message: 'P0001: invite_revoked' })).toBe('revoked');
        expect(mapInviteError({ message: 'invite_already_used' })).toBe('already_used');
        expect(mapInviteError({ message: 'already_member' })).toBe('already_member');
        expect(mapInviteError({ message: 'seat_limit_reached' })).toBe('seat_limit');
        expect(mapInviteError({ message: 'invite_invalid' })).toBe('invalid');
    });

    it('maps network failures', () => {
        expect(mapInviteError(new TypeError('Failed to fetch'))).toBe('network');
    });

    it('maps unknown to generic', () => {
        expect(mapInviteError(new Error('something else'))).toBe('generic');
        expect(mapInviteError(null)).toBe('generic');
    });
});
