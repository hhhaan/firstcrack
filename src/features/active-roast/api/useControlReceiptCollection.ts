import { invalidateRoastSessionQueries } from '@entities/roast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import {
    drainControlReceipts,
    pruneReceiptCollections,
    registerReceiptCollection,
    restoreReceiptCollections,
    syncSavedControlReceipts,
    useControlReceiptStore,
} from '../model/controlReceiptCollector';
import { useRoastingStore } from '../model/status';

/** Lives above the view boundary; collecting receipts never grants heater authority. */
export const useControlReceiptCollection = () => {
    const qc = useQueryClient();
    const restored = useRef(false);
    useQuery({
        queryKey: ['active-roast-control-receipts'],
        queryFn: async () => {
            if (!restored.current) {
                restoreReceiptCollections();
                restored.current = true;
            }
            const state = useRoastingStore.getState();
            if (state.acceptedCharge && state.sessionOwnerId)
                registerReceiptCollection(state.acceptedCharge, state.sessionOwnerId);
            const snapshot = state.completed?.snapshot;
            if (snapshot?.acceptedCharge && snapshot.sessionOwnerId)
                registerReceiptCollection(snapshot.acceptedCharge, snapshot.sessionOwnerId);
            const results = await Promise.allSettled(
                Object.values(useControlReceiptStore.getState().collections).map(async (collection) => {
                    await drainControlReceipts(collection.charge.session_id);
                    if (await syncSavedControlReceipts(collection.charge.session_id))
                        await invalidateRoastSessionQueries(qc, collection.ownerId);
                }),
            );
            pruneReceiptCollections();
            const failed = results.find((result) => result.status === 'rejected');
            if (failed?.status === 'rejected') throw failed.reason;
            return null;
        },
        refetchInterval: 1000,
        refetchIntervalInBackground: true,
        retry: false,
        throwOnError: false,
    });
};
