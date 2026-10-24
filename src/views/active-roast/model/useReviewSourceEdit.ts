import { useActiveWorkspace } from '@entities/organization';
import { useRoastSession, useUpdateRoastSession } from '@entities/roast';
import { useRoastStockRecorded } from '@features/active-roast/api/useRoastStockRecorded';
import { type RoastSelection, selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRef, useState } from 'react';

export const useReviewSourceEdit = () => {
    const review = useRoastingStore(selectReviewSnapshot);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const ownsReview = isWorkspaceReady && !!workspaceOwnerId && review?.sessionOwnerId === workspaceOwnerId;
    const { data: session } = useRoastSession(ownsReview ? workspaceOwnerId : '', ownsReview ? review.sessionId : '');
    const { data: stockRecorded } = useRoastStockRecorded(
        ownsReview ? (session?.id ?? '') : '',
        session?.plan_batch_id,
    );
    const { mutateAsync, isPending } = useUpdateRoastSession(workspaceOwnerId);
    const submitting = useRef(false);
    const [failedSessionId, setFailedSessionId] = useState<string | null>(null);
    const canWrite = ownsReview && session?.user_id === workspaceOwnerId && stockRecorded === false;

    const save = async (source: Required<Pick<RoastSelection, 'beanId' | 'blendId' | 'beanName'>>) => {
        if (!canWrite || isPending || submitting.current) return;
        if (source.beanId === session.bean_id && source.blendId === session.blend_id) return;
        submitting.current = true;
        setFailedSessionId(null);
        // Legacy records derive their title from the source; freeze it before relinking.
        const frozenTitle = session.batch_name?.trim()
            ? null
            : session.blends?.name.trim() || session.bean_label?.trim() || session.beans?.name.trim() || null;
        try {
            await mutateAsync({
                id: review.sessionId,
                bean_id: source.beanId,
                blend_id: source.blendId,
                ...(source.beanId || source.blendId ? { bean_label: null } : {}),
                ...(frozenTitle ? { batch_name: frozenTitle } : {}),
            });
            useRoastingStore.getState().replaceReviewSource(review.sessionId, workspaceOwnerId, source);
        } catch {
            setFailedSessionId(review.sessionId);
        } finally {
            submitting.current = false;
        }
    };

    return { session, canWrite, isPending, failed: failedSessionId === review?.sessionId, stockRecorded, save };
};
