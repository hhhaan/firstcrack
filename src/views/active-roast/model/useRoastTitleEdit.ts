import { useActiveWorkspace } from '@entities/organization';
import { useRoastSession, useUpdateRoastSession } from '@entities/roast';
import { automaticBatchTitle } from '@features/active-roast/lib/batch-title';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useState } from 'react';

export const useRoastTitleEdit = (sessionId: string, fallbackTitle: string) => {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const review = useRoastingStore(selectReviewSnapshot);
    const sessionOwnerId = useRoastingStore((state) => state.sessionOwnerId);
    const runningTitle = useRoastingStore((state) => state.activeSelection?.identity?.title);
    const reviewing = review?.sessionId === sessionId;
    const ownerId = reviewing ? review.sessionOwnerId : sessionOwnerId;
    const canWrite = isWorkspaceReady && !!workspaceOwnerId && ownerId === workspaceOwnerId;
    const session = useRoastSession(canWrite && reviewing ? workspaceOwnerId : '', reviewing ? sessionId : '');
    const { mutateAsync, isPending } = useUpdateRoastSession(workspaceOwnerId);
    const [failed, setFailed] = useState(false);
    const title = reviewing ? session.data?.batch_name || fallbackTitle : fallbackTitle;

    const save = async (draft: string) => {
        if (!canWrite || isPending) return;
        setFailed(false);
        if (!reviewing) {
            useRoastingStore.getState().setRunningBatchTitle(sessionId, draft);
            return;
        }
        const next =
            draft.trim().slice(0, 120) ||
            (review.selection.identity ? automaticBatchTitle(review.selection.identity) : fallbackTitle);
        try {
            await mutateAsync({ id: sessionId, batch_name: next });
            useRoastingStore.getState().replaceReviewTitle(sessionId, ownerId, next);
        } catch {
            setFailed(true);
        }
    };

    return { title, editableTitle: reviewing ? title : (runningTitle ?? title), canWrite, save, isPending, failed };
};
