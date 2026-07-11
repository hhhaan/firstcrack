import type { AuthErrorCode } from '@shared/store/auth';

export type { AuthErrorCode };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Map email/password (and generic) auth failures to a stable UI code. OAuth call sites use `oauth_failed` directly. */
export const mapAuthError = (error: unknown): AuthErrorCode => {
    if (!error) return 'generic';

    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    let message: string;
    if (error instanceof Error) message = error.message;
    else if (isRecord(error) && typeof error.message === 'string') message = error.message;
    else message = String(error);
    const lower = message.toLowerCase();

    if (
        code === 'invalid_credentials' ||
        code === 'invalid_grant' ||
        /invalid login|invalid credentials|invalid email or password|wrong password|user not found/i.test(lower)
    ) {
        return 'invalid_credentials';
    }

    if (
        code === 'network_error' ||
        error instanceof TypeError ||
        /failed to fetch|networkerror|network request failed|load failed|fetch failed|econnrefused|enotfound|offline/i.test(
            lower,
        )
    ) {
        return 'network';
    }

    return 'generic';
};
