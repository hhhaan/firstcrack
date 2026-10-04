import { BBP_INPROGRESS_ID, useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { deleteBbpTsv } from '@shared/lib/tsv-writer';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';

/**
 * User pressed Disconnect and the sidecar released the link.
 * Link loss does not come through here, so an in-progress roast stays.
 * A dropped batch waiting to be saved stays in the summary; only the live trace is cleared.
 */
export const applyExplicitDisconnectReset = (
    setLivePoints: (points: LiveRoastPoint[]) => void,
    setLogEntries: (entries: LogEntry[]) => void,
): void => {
    useBbpStore.getState().abort();
    void deleteBbpTsv(BBP_INPROGRESS_ID);

    const store = useRoastingStore.getState();
    if (store.phase === 'roasting') {
        store.reset();
        useRoastingStore.getState().setConnected(false);
    }

    setLivePoints([]);
    setLogEntries([]);
};
