import { errorMessage, isOpaqueNetworkError } from '@shared/lib/errorMessage';
import type { AuthErrorCode } from '@shared/store/auth';

export type { AuthErrorCode };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Map email/password (and generic) auth failures to a stable UI code. OAuth call sites use `oauth_failed` directly. */
export const mapAuthError = (error: unknown): AuthErrorCode => {
    if (!error) return 'generic';

    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const lower = errorMessage(error).toLowerCase();

    if (
        code === 'invalid_credentials' ||
        code === 'invalid_grant' ||
        /invalid login|invalid credentials|invalid email or password|wrong password|user not found/i.test(lower)
    ) {
        return 'invalid_credentials';
    }

    if (code === 'network_error' || isOpaqueNetworkError(error)) {
        return 'network';
    }

    return 'generic';
};
