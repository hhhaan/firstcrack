import type { RoastSession } from '@shared/types/database.types';
import type { BatchTitleNumbering } from '@shared/types/roast';

export type RoastBatchIdentity = {
    name: string | null;
    title?: string;
    edited?: boolean;
};

/** Preview numbers are display-only; the save transaction assigns the final suffix. */
export const automaticBatchTitle = (
    identity: Pick<RoastBatchIdentity, 'name'>,
    numbering: BatchTitleNumbering = 'none',
    numbers?: Pick<RoastSession, 'profile_batch_number' | 'total_batch_number'>,
): string => {
    const suffix = [
        (numbering === 'profile' || numbering === 'both') && numbers?.profile_batch_number
            ? `#${numbers.profile_batch_number}`
            : '',
        (numbering === 'total' || numbering === 'both') && numbers?.total_batch_number
            ? `Σ#${numbers.total_batch_number}`
            : '',
    ]
        .filter(Boolean)
        .join(' · ');
    const name = identity.name?.trim() || 'Roast';
    return suffix ? `${name.slice(0, 119 - suffix.length)} ${suffix}` : name.slice(0, 120);
};
