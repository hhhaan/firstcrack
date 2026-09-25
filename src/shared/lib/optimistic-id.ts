/** Client-only ids from optimistic creates (`opt_` + uuid). Never a Postgres uuid. */
export const OPTIMISTIC_ID_PREFIX = 'opt_';

export const isOptimisticId = (id: string | null | undefined): id is `opt_${string}` =>
    typeof id === 'string' && id.startsWith(OPTIMISTIC_ID_PREFIX);

/** Drop unsaved ids before they can be sent as uuid columns. */
export const persistedId = (id: string | null | undefined): string | null => (id && !isOptimisticId(id) ? id : null);

type ReplacedListener = (from: string, to: string) => void;

const replacedListeners = new Set<ReplacedListener>();
/** ponytail: one entry per created lot, never evicted. A session creates handfuls, not thousands. */
const sourceByTarget = new Map<string, string>();
const targetBySource = new Map<string, string>();

export const subscribeOptimisticIdReplaced = (listener: ReplacedListener): (() => void) => {
    replacedListeners.add(listener);
    return () => replacedListeners.delete(listener);
};

export const optimisticReplacementSource = (id: string): string | undefined => sourceByTarget.get(id);

export const optimisticReplacementTarget = (id: string): string | undefined => targetBySource.get(id);

export const publishOptimisticIdReplaced = (from: string, to: string): void => {
    if (!isOptimisticId(from) || from === to) return;
    sourceByTarget.set(to, from);
    targetBySource.set(from, to);
    for (const listener of [...replacedListeners]) listener(from, to);
};
