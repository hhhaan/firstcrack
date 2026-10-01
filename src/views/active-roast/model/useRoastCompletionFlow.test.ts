import { completedKey } from '@features/active-roast/model/completed';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { beforeEach, expect, it } from 'vitest';

const summary = { totalTime: '10:00', development: '2:00', finalBt: '200', logEntries: [] };
const plant = (ownerId: string, sessionId: string) => {
    const key = completedKey(ownerId, sessionId);
    useRoastingStore.getState().hydrateCompleted(
        { ...summary, sessionId, sessionOwnerId: ownerId },
        {
            userId: ownerId,
            sessionId,
            elapsed: 600,
            roastStartTime: 1000,
            rawBT: 200,
            selectedBeanId: null,
            targetProfileId: null,
            planBatchHandoff: null,
            handoffBeanName: null,
            logEntries: [],
            formData: { notes: '', weightGrams: 0, roastLevel: null, beanId: null },
        },
    );
    return key;
};
beforeEach(() => useRoastingStore.getState().clear());

it('closes a matching summary and opens the next-plan candidates after success', () => {
    const key = plant('owner', 'a');
    const candidates = [{ id: 'next' }] as PlanBatchWithProgress[];
    const store = useRoastingStore.getState();
    store.openCompleted(key);
    store.saveSucceeded(key, candidates);
    expect(useRoastingStore.getState().completionUi).toMatchObject({
        summaryKey: null,
        summaryModal: false,
        continueModal: true,
        continueCandidates: candidates,
    });
    store.dismissContinue();
    expect(useRoastingStore.getState().completionUi.continueCandidates).toEqual([]);
});

it('closes a matching summary without opening continue when no plan remains', () => {
    const key = plant('owner', 'a');
    useRoastingStore.getState().openCompleted(key);
    useRoastingStore.getState().saveSucceeded(key);
    expect(useRoastingStore.getState().completionUi).toMatchObject({
        summaryModal: false,
        summaryKey: null,
        continueModal: false,
    });
});

it.each([
    ['owner', 'b'],
    ['other-owner', 'a'],
])('keeps %s/%s summary when owner/a succeeds late', (owner, session) => {
    const a = plant('owner', 'a');
    const b = plant(owner, session);
    useRoastingStore.getState().openCompleted(b);
    const ui = useRoastingStore.getState().completionUi;
    const record = useRoastingStore.getState().completedRecords[b];
    useRoastingStore.getState().saveSucceeded(a, [{ id: 'next' }] as PlanBatchWithProgress[]);
    expect(useRoastingStore.getState().completionUi).toBe(ui);
    expect(useRoastingStore.getState().completedRecords[b]).toBe(record);
});

it('close hides the modal and retains the selected record for reopen and remount', () => {
    const key = plant('owner', 'a');
    const store = useRoastingStore.getState();
    store.openCompleted(key);
    store.closeSummary();
    expect(useRoastingStore.getState().completionUi).toMatchObject({ summaryModal: false, summaryKey: key });
    store.openCompleted(key);
    expect(useRoastingStore.getState().completionUi.summaryModal).toBe(true);
    expect(useRoastingStore.getState().completedRecords[key].summary).toMatchObject(summary);
});

it('cannot reopen discarded or saved records', () => {
    const key = plant('owner', 'a');
    const store = useRoastingStore.getState();
    store.saveSucceeded(key);
    store.openCompleted(key);
    expect(useRoastingStore.getState().completionUi.summaryModal).toBe(false);
    store.discardCompleted(key);
    store.openCompleted(key);
    expect(useRoastingStore.getState().completionUi.summaryModal).toBe(false);
});

it('resetting modal selection preserves completed records', () => {
    const key = plant('owner', 'a');
    const store = useRoastingStore.getState();
    store.openCompleted(key);
    store.resetCompletionUi();
    expect(useRoastingStore.getState().completedRecords[key]).toBeDefined();
    expect(useRoastingStore.getState().completionUi.summaryModal).toBe(false);
});
