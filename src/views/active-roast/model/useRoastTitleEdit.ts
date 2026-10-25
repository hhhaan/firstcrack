import { useActiveWorkspace } from '@entities/organization';
import { useRoastingStore } from '@features/active-roast/model/status';

export const useRoastTitleEdit = (sessionId: string, fallbackTitle: string) => {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const sessionOwnerId = useRoastingStore((state) => state.sessionOwnerId);
    const runningSessionId = useRoastingStore((state) => (state.phase === 'roasting' ? state.sessionId : null));
    const runningTitle = useRoastingStore((state) => state.activeSelection?.identity?.title);
    const canWrite =
        isWorkspaceReady && !!workspaceOwnerId && sessionOwnerId === workspaceOwnerId && runningSessionId === sessionId;

    const save = (draft: string) => {
        if (canWrite) useRoastingStore.getState().setRunningBatchTitle(sessionId, draft);
    };

    return { editableTitle: runningTitle ?? fallbackTitle, canWrite, save };
};
