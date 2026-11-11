import {
    type ProfileReferenceBatch,
    type RoastProfileWithSource,
    resolveSourceSession,
    useRoastProfileCurve,
    useSourceSessionEvents,
} from '@entities/roast-profile';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { useMemo } from 'react';
import { profileBatchSourceSession } from '../lib/source-session';

export function useProfileBatchPreview(
    profile: RoastProfileWithSource,
    previewSessionId: string,
    batches: ProfileReferenceBatch[],
) {
    const batch = batches.find((item) => item.id === previewSessionId);
    const tsvPath = batch?.tsv_path ?? null;
    const curve = useRoastProfileCurve(tsvPath);
    const events = useSourceSessionEvents(previewSessionId);

    const points = !tsvPath || curve.isPending ? [] : (curve.data ?? []);
    const isLoading = !!tsvPath && (curve.isPending || curve.isFetching);
    const isError = !!tsvPath && curve.isError;

    const chartProfile = useMemo(
        () => ({
            user_id: profile.user_id,
            source_session_id: previewSessionId,
            source_session: (batch
                ? profileBatchSourceSession(batch)
                : resolveSourceSession(profile.source_session)) as RoastProfileWithSource['source_session'],
            duration_sec: profile.duration_sec,
        }),
        [profile.user_id, profile.source_session, profile.duration_sec, batch, previewSessionId],
    );

    return {
        points,
        events: events.data ?? null,
        isLoading,
        isError,
        chartProfile,
        batchTitle: batch ? (sessionRoastTitle(batch) ?? null) : null,
    };
}
