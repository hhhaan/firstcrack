import { DEFAULT_TOTAL_BATCH_PREFIX, totalBatchMark } from '@shared/lib/sessionRoastTitle';
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
    prefix: unknown = DEFAULT_TOTAL_BATCH_PREFIX,
): string => {
    const suffix = [
        (numbering === 'profile' || numbering === 'both') && numbers?.profile_batch_number
            ? `#${numbers.profile_batch_number}`
            : '',
        (numbering === 'total' || numbering === 'both') && numbers?.total_batch_number
            ? totalBatchMark(numbers.total_batch_number, prefix)
            : '',
    ]
        .filter(Boolean)
        .join(' · ');
    const name = identity.name?.trim() ?? '';
    if (!name) return suffix;
    return suffix ? `${name.slice(0, 119 - suffix.length)} ${suffix}` : name.slice(0, 120);
};
