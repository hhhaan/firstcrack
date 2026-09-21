import { canCancelDrop } from '@features/active-roast/lib/drop-transition';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { LogEntry } from '@shared/types/roast';
import { create } from 'zustand';
import type { LiveRoastPoint } from './useSidecarPolling';

export interface CompletedRoastRestore {
    sessionId: string;
    roastStartMs: number;
    elapsed: number;
    logEntries: LogEntry[];
    livePoints: LiveRoastPoint[];
    sessionOwnerId: string | null;
}

interface CompletedRoastState {
    restore: CompletedRoastRestore | null;
    droppedSessionId: string | null;
    submitted: boolean;
    capture: (restore: CompletedRoastRestore) => void;
    markSubmitted: (sessionId: string) => void;
    /** Next Charge started — Drop cancel must not rewind the new batch. */
    lockAfterCharge: (liveSessionId: string | null) => void;
    clear: () => void;
}

const empty = {
    restore: null as CompletedRoastRestore | null,
    droppedSessionId: null as string | null,
    submitted: false,
};

export const useCompletedRoastStore = create<CompletedRoastState>((set, get) => ({
    ...empty,
    capture: (restore) => set({ restore, droppedSessionId: restore.sessionId, submitted: false }),
    markSubmitted: (sessionId) => {
        const { restore } = get();
        if (restore && restore.sessionId !== sessionId) return;
        set({ submitted: true, restore: null });
    },
    lockAfterCharge: (liveSessionId) => {
        const { restore } = get();
        if (!restore) return;
        if (liveSessionId && liveSessionId !== restore.sessionId) set({ restore: null });
    },
    clear: () => set({ ...empty }),
}));

export const isDropCancelable = (): boolean => {
    const { restore, submitted } = useCompletedRoastStore.getState();
    if (!restore) return false;
    const live = useRoastingStore.getState();
    const nextCharged = Boolean(live.charged && live.sessionId && live.sessionId !== restore.sessionId);
    return canCancelDrop({ nextCharged, submitted });
};
