/**
 * Action-scoped op id for inventory writes (packaging / blending).
 * Same user action retries must reuse the key so partial unique indexes can no-op.
 * A new id is issued when content changes, after success, or on explicit reset.
 */
export type ActionOpIdSession = {
    /** Current id for this content key, creating one if needed. */
    getOrCreate: (contentKey?: string) => string;
    /** Call after successful RPC — next getOrCreate yields a fresh id. */
    markSucceeded: () => void;
    /** Drop pending id (e.g. modal close without submit). */
    reset: () => void;
    /** Peek without creating (tests / debug). */
    peek: () => string | null;
};

export function createActionOpIdSession(createId: () => string = () => crypto.randomUUID()): ActionOpIdSession {
    let current: string | null = null;
    let boundKey: string | null = null;
    return {
        getOrCreate: (contentKey?: string) => {
            if (contentKey !== undefined) {
                if (current != null && boundKey !== contentKey) {
                    current = createId();
                }
                boundKey = contentKey;
            }
            if (current == null) current = createId();
            return current;
        },
        markSucceeded: () => {
            current = null;
            boundKey = null;
        },
        reset: () => {
            current = null;
            boundKey = null;
        },
        peek: () => current,
    };
}
