import type { ProfileReferenceBatch, RoastProfileWithSource } from '@entities/roast-profile';
import { useRoastProfileCurve, useSourceSessionEvents } from '@entities/roast-profile';
import { useMemo } from 'react';
import { resolveProfileBatchPreview } from '../lib/resolve-profile-batch-preview';

export function useProfileBatchPreview(
    profile: RoastProfileWithSource,
    previewSessionId: string,
    batches: ProfileReferenceBatch[],
    batchesLoading: boolean,
) {
    const resolved = useMemo(
        () => resolveProfileBatchPreview(profile, previewSessionId, batches, batchesLoading),
        [profile, previewSessionId, batches, batchesLoading],
    );
    const curve = useRoastProfileCurve(resolved.tsvPath);
    const events = useSourceSessionEvents(previewSessionId);

    const curvePending = !!resolved.tsvPath && (curve.isPending || curve.isFetching);
    const isLoading = resolved.awaitingBatchMeta || curvePending;
    const isError = !!resolved.tsvPath && curve.isError;
    const points = !resolved.tsvPath || curve.isPending ? [] : (curve.data ?? []);

    return {
        points,
        events: events.data ?? null,
        isLoading,
        isError,
        chartProfile: resolved.chartProfile,
        batchTitle: resolved.batchTitle,
    };
}
