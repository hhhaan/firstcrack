/**
 * Action-scoped op id for inventory writes (packaging / blending).
 * Same user action retries must reuse the key so partial unique indexes can no-op.
 * A new id is issued only after a successful commit (or explicit reset).
 */
export type ActionOpIdSession = {
    /** Current id, creating one if needed. A different key starts a new id. */
    getOrCreate: (key?: string) => string;
    /** Call after successful RPC — next getOrCreate yields a fresh id. */
    markSucceeded: () => void;
    /** Drop pending id (e.g. modal close without submit). */
    reset: () => void;
    /** Peek without creating (tests / debug). */
    peek: () => string | null;
};

export function createActionOpIdSession(createId: () => string = () => crypto.randomUUID()): ActionOpIdSession {
    let current: { key: string; id: string } | null = null;
    return {
        getOrCreate: (key = '') => {
            if (current?.key !== key) current = { key, id: createId() };
            return current.id;
        },
        markSucceeded: () => {
            current = null;
        },
        reset: () => {
            current = null;
        },
        peek: () => current?.id ?? null,
    };
}
