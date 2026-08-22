import { i18n } from '@shared/i18n';
import { formatMutationError, resolveMutationErrorText } from '@shared/lib/mutationErrorMessage';
import { useToastStore } from '@shared/store/toast';

/**
 * Global feedback for a failed write. A failed mutation must never look like a
 * success; mutations that already render their own inline error opt out with
 * `meta: { silentError: true }` so the user is told exactly once.
 */
export const showMutationErrorToast = (error: unknown, meta: { silentError?: boolean } | undefined) => {
    if (meta?.silentError) return;
    useToastStore.getState().show(formatMutationError(i18n.t, resolveMutationErrorText(error)));
};
