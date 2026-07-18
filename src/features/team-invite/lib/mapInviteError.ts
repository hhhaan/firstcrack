export type InviteErrorCode =
    | 'expired'
    | 'revoked'
    | 'already_used'
    | 'already_member'
    | 'seat_limit'
    | 'invalid'
    | 'network'
    | 'generic';

function messageOf(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        return (err as { message: string }).message;
    }
    return '';
}

/** Map PostgREST / RPC RAISE codes to stable UI error codes. */
export function mapInviteError(err: unknown): InviteErrorCode {
    if (err instanceof TypeError) return 'network';

    const msg = messageOf(err).toLowerCase();
    if (!msg) return 'generic';

    if (msg.includes('invite_expired')) return 'expired';
    if (msg.includes('invite_revoked')) return 'revoked';
    if (msg.includes('invite_already_used')) return 'already_used';
    if (msg.includes('already_member')) return 'already_member';
    if (msg.includes('seat_limit_reached')) return 'seat_limit';
    if (msg.includes('invite_invalid')) return 'invalid';
    if (msg.includes('failed to fetch') || msg.includes('network')) return 'network';

    return 'generic';
}
