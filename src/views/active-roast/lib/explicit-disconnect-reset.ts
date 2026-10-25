import { BBP_INPROGRESS_ID, useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { deleteBbpTsv } from '@shared/lib/tsv-writer';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';

/**
 * User pressed Disconnect and the sidecar released the link.
 * Link loss does not come through here, so an in-progress roast stays.
 * The live screen goes idle: no preheat, no BBP, no Charge wait.
 * An unsubmitted Drop summary stays so that batch can still be saved.
 */
export const applyExplicitDisconnectReset = (
    setLivePoints: (points: LiveRoastPoint[]) => void,
    setLogEntries: (entries: LogEntry[]) => void,
): void => {
    useBbpStore.getState().abort();
    void deleteBbpTsv(BBP_INPROGRESS_ID);

    const store = useRoastingStore.getState();
    const unsaved = store.completed?.submitted === false ? store.completed : null;
    store.reset();
    useRoastingStore.setState({
        sidecarConnected: false,
        ...(unsaved && { completed: unsaved }),
    });

    setLivePoints([]);
    setLogEntries([]);
};
