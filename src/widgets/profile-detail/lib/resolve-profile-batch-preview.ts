import { type ProfileReferenceBatch, type RoastProfileWithSource, resolveSourceSession } from '@entities/roast-profile';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { profileBatchSourceSession } from './source-session';

export const previewBatchRowClass = (current: boolean, preview: boolean) => {
    if (current) return 'bg-emerald-50/80 dark:bg-emerald-950/35';
    if (preview) return 'bg-surface-elevated';
    return 'hover:bg-surface-elevated';
};

/** Resolves curve path and metadata for a batch-list preview selection. */
export const resolveProfileBatchPreview = (
    profile: RoastProfileWithSource,
    previewSessionId: string,
    batches: ProfileReferenceBatch[],
    batchesLoading: boolean,
) => {
    const batch = batches.find((item) => item.id === previewSessionId);
    const embedded = resolveSourceSession(profile.source_session);
    const isProfileSource = previewSessionId === profile.source_session_id;
    const tsvPath = batch?.tsv_path ?? (isProfileSource ? (embedded?.tsv_path ?? null) : null);
    const awaitingBatchMeta = batchesLoading && !batch && !isProfileSource;
    const sourceSession = (
        batch ? profileBatchSourceSession(batch) : isProfileSource ? embedded : null
    ) as RoastProfileWithSource['source_session'];
    const durationSec = batch
        ? profile.duration_sec
        : ((typeof embedded?.duration_seconds === 'number' ? embedded.duration_seconds : null) ?? profile.duration_sec);

    return {
        batch,
        tsvPath,
        awaitingBatchMeta,
        chartProfile: {
            user_id: profile.user_id,
            source_session_id: previewSessionId,
            source_session: sourceSession,
            duration_sec: durationSec,
        },
        batchTitle: batch ? (sessionRoastTitle(batch) ?? null) : isProfileSource ? (profile.name ?? null) : null,
    };
};
