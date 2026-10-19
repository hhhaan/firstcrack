import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { useEffect, useState } from 'react';
import { allocateBatchNumber, parseBatchNumberLedger } from '../lib/batch-number';
import { useRoastingStore } from './status';

const KEY = 'roast.batchNumbers';
let queue: Promise<unknown> = Promise.resolve();
export function useBatchNumber() {
    const sessionId = useRoastingStore((s) => s.sessionId);
    const ownerId = useRoastingStore((s) => s.sessionOwnerId);
    const profileId = useRoastingStore((s) => s.activeSelection?.profileId ?? null);
    const [allocation, setAllocation] = useState<{ sessionId: string; number: number } | null>(null);
    useEffect(() => {
        if (!sessionId || !ownerId) return;
        let disposed = false;
        queue = queue
            .catch(() => undefined)
            .then(async () => {
                const stored = await settingsGet<unknown>(KEY);
                let fallback: unknown;
                try {
                    fallback = JSON.parse(localStorage.getItem(KEY) ?? 'null');
                } catch {
                    /* no local ledger */
                }
                const result = allocateBatchNumber(
                    parseBatchNumberLedger(fallback ?? stored),
                    ownerId,
                    profileId,
                    sessionId,
                );
                let localSaved = false;
                try {
                    localStorage.setItem(KEY, JSON.stringify(result.ledger));
                    localSaved = true;
                } catch {
                    /* Desktop settings can still persist the allocation. */
                }
                try {
                    await settingsSet(KEY, result.ledger, { throwOnError: true });
                } catch (error) {
                    if (!localSaved) throw error;
                }
                if (!disposed) setAllocation({ sessionId, number: result.number });
            })
            .catch(() => {
                if (!disposed) setAllocation(null);
            });
        return () => {
            disposed = true;
        };
    }, [sessionId, ownerId, profileId]);
    return allocation?.sessionId === sessionId ? allocation.number : null;
}
