import type { ProfileReferenceBatch } from '@entities/roast-profile';
import type { Json } from '@shared/types/database.types';

/** Snapshot written to `roast_profiles.source_session` when the reference batch changes. */
export const profileBatchSourceSession = (batch: ProfileReferenceBatch) => ({
    tsv_path: batch.tsv_path,
    bbp_tsv_path: batch.bbp_tsv_path,
    bbp_seconds: batch.bbp_seconds,
    events: null as Json | null,
    ...(batch.heater_events !== undefined && { heater_events: batch.heater_events }),
    ...(batch.duration_seconds !== undefined && { duration_seconds: batch.duration_seconds }),
});
