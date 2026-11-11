import { type ProfileReferenceBatch, type RoastProfileWithSource, resolveSourceSession } from '@entities/roast-profile';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { profileBatchSourceSession } from './source-session';

export const previewBatchRowClass = (current: boolean, preview: boolean) => {
    if (current) return 'bg-emerald-50/80 dark:bg-emerald-950/35';
    if (preview) return 'bg-surface-elevated';
    return 'hover:bg-surface-elevated';
};

const embeddedTsvPath = (embedded: ReturnType<typeof resolveSourceSession>) => embedded?.tsv_path ?? null;

const previewDurationSec = (
    batch: ProfileReferenceBatch | undefined,
    embedded: ReturnType<typeof resolveSourceSession>,
    profile: RoastProfileWithSource,
) => {
    if (batch) return profile.duration_sec;
    if (typeof embedded?.duration_seconds === 'number') return embedded.duration_seconds;
    return profile.duration_sec;
};

const previewSourceSession = (
    batch: ProfileReferenceBatch | undefined,
    isProfileSource: boolean,
    embedded: ReturnType<typeof resolveSourceSession>,
) => {
    if (batch) return profileBatchSourceSession(batch);
    if (isProfileSource) return embedded;
    return null;
};

const previewBatchTitle = (
    batch: ProfileReferenceBatch | undefined,
    isProfileSource: boolean,
    profile: RoastProfileWithSource,
) => {
    if (batch) return sessionRoastTitle(batch) ?? null;
    if (isProfileSource) return profile.name ?? null;
    return null;
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
    const tsvPath = batch?.tsv_path ?? (isProfileSource ? embeddedTsvPath(embedded) : null);
    const needsListTsv = isProfileSource && !embeddedTsvPath(embedded);
    const awaitingBatchMeta = batchesLoading && !batch && (!isProfileSource || needsListTsv);

    return {
        batch,
        tsvPath,
        awaitingBatchMeta,
        chartProfile: {
            user_id: profile.user_id,
            source_session_id: previewSessionId,
            source_session: previewSourceSession(
                batch,
                isProfileSource,
                embedded,
            ) as RoastProfileWithSource['source_session'],
            duration_sec: previewDurationSec(batch, embedded, profile),
        },
        batchTitle: previewBatchTitle(batch, isProfileSource, profile),
    };
};
