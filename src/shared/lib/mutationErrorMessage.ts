/** Longer server messages are truncated so a toast stays one glanceable line block. */
const MAX_DETAIL_LENGTH = 160;

/** Transport-level strings that tell the user nothing actionable. */
const OPAQUE_MESSAGES = new Set([
    'failed to fetch',
    'fetch failed',
    'load failed',
    'network error',
    'network request failed',
]);

export type MutationErrorText =
    | { key: 'errors.mutationFailed' }
    | { key: 'errors.mutationFailedDetail'; detail: string };

/**
 * Maps a failed mutation to the i18n key used for the global toast.
 *
 * A 4xx/5xx fork is not available here: Supabase errors carry no HTTP status
 * (`PostgrestError` is code/message/details, `FunctionsHttpError` hides the response
 * under `context`), so a status branch would collapse to "generic" for every server
 * write. The honest split is whether the failure carries a message worth showing.
 */
export const resolveMutationErrorText = (error: unknown): MutationErrorText => {
    const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const detail = raw.trim();
    if (!detail || OPAQUE_MESSAGES.has(detail.toLowerCase())) return { key: 'errors.mutationFailed' };
    return {
        key: 'errors.mutationFailedDetail',
        detail: detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}…` : detail,
    };
};
