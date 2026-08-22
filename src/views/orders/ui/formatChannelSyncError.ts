import { formatMutationError, resolveMutationErrorText } from '@shared/lib/mutationErrorMessage';

/** Same interpolation as the global mutation toast — i18n key uses `{{message}}`. */
export const formatChannelSyncError = (t: (key: string, options?: { message: string }) => string, err: unknown) =>
    formatMutationError(t, resolveMutationErrorText(err));
