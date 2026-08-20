import { errorMessage, isOpaqueNetworkError } from '@shared/lib/errorMessage';

export type InviteErrorCode =
    | 'expired'
    | 'revoked'
    | 'already_used'
    | 'already_member'
    | 'seat_limit'
    | 'invalid'
    | 'network'
    | 'generic';

/** Map PostgREST / RPC RAISE codes to stable UI error codes. */
export function mapInviteError(err: unknown): InviteErrorCode {
    if (isOpaqueNetworkError(err)) return 'network';

    const msg = errorMessage(err).toLowerCase();
    if (!msg) return 'generic';

    if (msg.includes('invite_expired')) return 'expired';
    if (msg.includes('invite_revoked')) return 'revoked';
    if (msg.includes('invite_already_used')) return 'already_used';
    if (msg.includes('already_member')) return 'already_member';
    if (msg.includes('seat_limit_reached')) return 'seat_limit';
    if (msg.includes('invite_invalid')) return 'invalid';

    return 'generic';
}
