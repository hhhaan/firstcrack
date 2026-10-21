export type BatchTitleNumbering = 'profile' | 'total' | 'both' | 'none';
export type RoastBatchIdentity = {
    profileId: string | null;
    name: string | null;
    number?: number;
    totalNumber?: number | null;
    numbering: BatchTitleNumbering;
    title?: string;
    edited?: boolean;
};

/** Keep the identifier suffix when a long profile name reaches the batch-name limit. */
export const automaticBatchTitle = (identity: RoastBatchIdentity): string => {
    const suffix = [
        (identity.numbering === 'profile' || identity.numbering === 'both') && identity.number != null
            ? `#${identity.number}`
            : null,
        (identity.numbering === 'total' || identity.numbering === 'both') && identity.totalNumber != null
            ? `Σ#${identity.totalNumber}`
            : null,
    ]
        .filter(Boolean)
        .join(' · ');
    const name = identity.name?.trim() || 'Roast';
    return suffix ? `${name.slice(0, 120 - suffix.length - 3)} · ${suffix}` : name.slice(0, 120);
};
