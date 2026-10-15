import { isRoastSaveUserError } from '@features/active-roast/lib/roastSaveBeanIdentity';
import { i18n } from '@shared/i18n';
import { errorMessage } from '@shared/lib/errorMessage';
import { BatchLimitError } from '@shared/lib/features';

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

/** Virtual/bad plan_batch_id — keep the pending snapshot so a later resolve can retry. */
export const isFixablePlanBatchIdError = (err: unknown): boolean => {
    const code = pgErrorCode(err);
    if (code === '22P02' || code === 'unresolvable_plan_batch_id') return true;
    return errorMessage(err).toLowerCase().includes('invalid plan_batch_id');
};

/** Human-readable save failure — PostgREST errors are plain objects, not Error. */
export const formatRoastSaveError = (err: unknown): string => {
    if (isRoastSaveUserError(err)) return err.message;
    if (err instanceof BatchLimitError) {
        return i18n.t(`planGate.${err.code}`, { used: err.used, max: err.max });
    }
    return errorMessage(err);
};

/** Validation the user can fix in the summary form — never send to Sentry. */
export const isRoastSaveUserFacingError = (err: unknown): boolean => isRoastSaveUserError(err);
