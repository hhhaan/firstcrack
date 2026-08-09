/** PostgREST/PostgREST-wrapped Postgres error code, or null when the error carries none. */
export const pgErrorCode = (err: unknown): string | null => {
    if (!err || typeof err !== 'object' || !('code' in err)) return null;
    return typeof err.code === 'string' ? err.code : null;
};

/**
 * Postgres integrity-violation class (23xxx): the row itself is invalid, so the
 * exact same payload fails identically forever. Idempotent retries converge on a
 * result only when the failure is transient — they do nothing for a deterministic one.
 *
 * Deliberately narrow. Plan-gate refusals (BatchLimitError: read_only_plan,
 * trial_batch_cap, monthly cap) look permanent but clear on upgrade or next month,
 * so they stay retryable — discarding one would throw away the user's roast.
 */
export const isPermanentSaveError = (err: unknown): boolean => {
    const code = pgErrorCode(err);
    return code !== null && /^23\d{3}$/.test(code);
};
