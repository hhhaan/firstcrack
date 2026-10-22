export type RoastBatchIdentity = {
    name: string | null;
    title?: string;
    edited?: boolean;
};

/** Numbers are assigned by the database when the roast is saved. */
export const automaticBatchTitle = (identity: Pick<RoastBatchIdentity, 'name'>): string =>
    (identity.name?.trim() || 'Roast').slice(0, 120);
