/** PostgREST/PostgREST-wrapped Postgres error code, or null when the error carries none. */
export const pgErrorCode = (err: unknown): string | null => {
    if (!err || typeof err !== 'object' || !('code' in err)) return null;
    return typeof err.code === 'string' ? err.code : null;
};

/**
 * Postgres integrity-violation class (23xxx): the same payload fails forever.
 * Plan-gate refusals stay retryable.
 */
export const isPermanentSaveError = (err: unknown): boolean => {
    const code = pgErrorCode(err);
    return code !== null && /^23\d{3}$/.test(code);
};
