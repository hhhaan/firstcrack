/** Extract a human-readable message from unknown throw values. */
export const errorMessage = (err: unknown): string => {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        return err.message;
    }
    return '';
};

/** Transport-level strings that tell the user nothing actionable. */
const OPAQUE_NETWORK_SNIPPETS = [
    'failed to fetch',
    'fetch failed',
    'load failed',
    'network error',
    'network request failed',
    'networkerror',
    'econnrefused',
    'enotfound',
    'offline',
];

/** Fetch/transport failures whose raw text should not leak into UI copy. */
export const isOpaqueNetworkError = (err: unknown): boolean => {
    if (err instanceof TypeError) return true;
    const msg = errorMessage(err).trim().toLowerCase();
    if (!msg) return false;
    return OPAQUE_NETWORK_SNIPPETS.some((snippet) => msg.includes(snippet));
};
