import { logger } from '@shared/lib/logger';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { useEffect } from 'react';
import { allocateBatchNumber, mergeBatchNumberLedgers } from '../lib/batch-number';
import { getRoastSettings } from './settings';
import { useRoastingStore } from './status';

const KEY = 'roast.batchNumbers';
let queue: Promise<void> = Promise.resolve();
function reserve(sessionId: string | null, ownerId: string | null, profileId: string | null) {
    if (!sessionId || !ownerId) return;
    const identity = useRoastingStore.getState().activeSelection?.identity;
    const numbering = identity?.totalNumber !== undefined ? identity.numbering : getRoastSettings().batchTitleNumbering;
    queue = queue
        .then(async () => {
            const stored = await settingsGet<unknown>(KEY);
            let fallback: unknown;
            try {
                fallback = JSON.parse(localStorage.getItem(KEY) ?? 'null');
            } catch {
                /* no local ledger */
            }
            const result = allocateBatchNumber(
                mergeBatchNumberLedgers(stored, fallback),
                ownerId,
                profileId,
                sessionId,
            );
            let localSaved = false;
            try {
                localStorage.setItem(KEY, JSON.stringify(result.ledger));
                localSaved = true;
            } catch {
                /* Desktop settings can still persist. */
            }
            try {
                await settingsSet(KEY, result.ledger, { throwOnError: true });
            } catch {
                // settingsSet already reports persistence failures through the shared logger.
                if (!localSaved) return;
            }
            useRoastingStore
                .getState()
                .assignBatchNumbers(sessionId, ownerId, result.number, result.totalNumber, numbering, profileId);
        })
        .catch((error) => {
            logger.capture(error, { feature: 'batch-number' });
        });
}

// Capture Charge synchronously, even when the screen is hidden or its boundary is recovering.
useRoastingStore.subscribe((state, previous) => {
    if (
        state.sessionId !== previous.sessionId ||
        state.sessionOwnerId !== previous.sessionOwnerId ||
        state.activeSelection?.profileId !== previous.activeSelection?.profileId
    ) {
        reserve(state.sessionId, state.sessionOwnerId, state.activeSelection?.profileId ?? null);
    }
});

export function useBatchNumber() {
    const sessionId = useRoastingStore((s) => s.sessionId);
    const ownerId = useRoastingStore((s) => s.sessionOwnerId);
    const profileId = useRoastingStore((s) => s.activeSelection?.profileId ?? null);
    useEffect(() => {
        const state = useRoastingStore.getState();
        if (
            state.sessionId === sessionId &&
            state.sessionOwnerId === ownerId &&
            (state.activeSelection?.profileId ?? null) === profileId
        )
            reserve(sessionId, ownerId, profileId);
    }, [sessionId, ownerId, profileId]);
    return useRoastingStore((state) =>
        state.sessionId && state.sessionOwnerId ? (state.activeSelection?.identity?.number ?? null) : null,
    );
}
