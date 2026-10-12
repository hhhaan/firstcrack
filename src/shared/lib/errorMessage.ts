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

/** Message-only transport check — TypeError bugs are not opaque just because they are TypeErrors. */
export const isOpaqueNetworkMessage = (msg: string): boolean => {
    const n = msg.trim().toLowerCase();
    if (!n) return false;
    return OPAQUE_NETWORK_SNIPPETS.some((snippet) => n.includes(snippet));
};

/** Fetch/transport failures whose raw text should not leak into UI copy. */
export const isOpaqueNetworkError = (err: unknown): boolean => {
    if (err instanceof TypeError) return true;
    return isOpaqueNetworkMessage(errorMessage(err));
};

/** Sidecar not listening yet, or 401 from a just-bound process racing the token header. */
export const isSidecarStartingError = (err: unknown): boolean => {
    if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'SidecarHttpError') {
        const status = (err as { status?: unknown }).status;
        if (status === 'network' || status === 'timeout') return true;
    }
    return isOpaqueNetworkError(err) || errorMessage(err).toLowerCase() === 'unauthorized';
};
