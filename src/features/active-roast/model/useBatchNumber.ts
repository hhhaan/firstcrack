import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { useEffect } from 'react';
import { create } from 'zustand';
import { allocateBatchNumber, parseBatchNumberLedger } from '../lib/batch-number';
import { useRoastingStore } from './status';

const KEY = 'roast.batchNumbers';
const useNumbers = create<Record<string, number>>(() => ({}));
let queue: Promise<void> = Promise.resolve();
function reserve(sessionId: string | null, ownerId: string | null, profileId: string | null) {
    if (!sessionId || !ownerId) return;
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
                /* Desktop settings can still persist. */
            }
            try {
                await settingsSet(KEY, result.ledger, { throwOnError: true });
            } catch (error) {
                if (!localSaved) throw error;
            }
            useNumbers.setState(
                Object.fromEntries(Object.entries(result.ledger.sessions).map(([id, value]) => [id, value.number])),
                true,
            );
        })
        .catch(() => {
            /* An unavailable ledger leaves the number undisplayed. */
        });
}

// Capture Charge synchronously, even when the screen is hidden or its boundary is recovering.
// Reference changes after Charge do not reassign that batch's numbering scope.
useRoastingStore.subscribe((state, previous) => {
    if (state.sessionId !== previous.sessionId || state.sessionOwnerId !== previous.sessionOwnerId) {
        reserve(state.sessionId, state.sessionOwnerId, state.activeSelection?.profileId ?? null);
    }
});

export function useBatchNumber() {
    const sessionId = useRoastingStore((s) => s.sessionId);
    const ownerId = useRoastingStore((s) => s.sessionOwnerId);
    useEffect(() => {
        const state = useRoastingStore.getState();
        if (state.sessionId === sessionId && state.sessionOwnerId === ownerId)
            reserve(sessionId, ownerId, state.activeSelection?.profileId ?? null);
    }, [sessionId, ownerId]);
    return useNumbers((numbers) =>
        sessionId && ownerId ? (numbers[JSON.stringify([ownerId, sessionId])] ?? null) : null,
    );
}
