/** Client-only ids from optimistic creates (`opt_` + uuid). Never a Postgres uuid. */
export const OPTIMISTIC_ID_PREFIX = 'opt_';

export const isOptimisticId = (id: string | null | undefined): id is `opt_${string}` =>
    typeof id === 'string' && id.startsWith(OPTIMISTIC_ID_PREFIX);

/** Drop unsaved ids before they can be sent as uuid columns. */
export const persistedId = (id: string | null | undefined): string | null => (id && !isOptimisticId(id) ? id : null);
