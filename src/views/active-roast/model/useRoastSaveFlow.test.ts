// @vitest-environment jsdom
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { completedKey } from '@features/active-roast/model/completed';
import {
    clearPendingRoastSave,
    listPendingRoastSaves,
    type PendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLiveDetachedFromPending, type UseRoastSaveFlowParams, useRoastSaveFlow } from './useRoastSaveFlow';

const sessionActions = {
    startBatch: useRoastSessionStore.getState().startBatch,
    completeBatch: useRoastSessionStore.getState().completeBatch,
    recordAdhocSave: useRoastSessionStore.getState().recordAdhocSave,
};

const handoffB: PlanBatchHandoff = {
    planBatchId: 'batch-b',
    planId: 'plan-b',
    beanId: 'bean-b',
    blendId: null,
    beanName: 'Next',
    batchSizeKg: 1,
    profileId: null,
    batchCount: 2,
    completedSessions: 0,
};

const mocks = vi.hoisted(() => ({
    ownerId: 'workspace-a',
    resumeSave: vi.fn(),
    startForRoast: vi.fn(),
    fetchQuery: vi.fn(),
    invalidateQueries: vi.fn(),
    invalidateScheduledBatchQueries: vi.fn(),
    upload: vi.fn(),
    message: vi.fn(),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: mocks.ownerId, isWorkspaceReady: true }),
}));
vi.mock('@entities/plan', () => ({
    useDayBatches: () => ({ data: [] }),
    planKeys: { dayBatches: (...parts: string[]) => parts },
    planBatchApi: { startForRoast: mocks.startForRoast, listForDateRange: vi.fn() },
    invalidateScheduledBatchQueries: mocks.invalidateScheduledBatchQueries,
}));
vi.mock('@features/active-roast/model/useSaveRoast', () => ({
    useSaveRoast: () => ({ resumeSave: mocks.resumeSave, isSaving: false }),
}));
vi.mock('@features/upload-roast-profile', () => ({ useUploadRoastProfile: () => ({ mutateAsync: mocks.upload }) }));
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ fetchQuery: mocks.fetchQuery, invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: mocks.message }));
vi.mock('@shared/lib/logger', () => ({
    logger: { capture: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots = new Set<ReturnType<typeof createRoot>>();
const summary = { totalTime: '10:00', development: '20%', finalBt: '200', logEntries: [] };
const form: RoastSummaryForm = {
    notes: '',
    weightGrams: 1,
    roastLevel: null,
    beanId: null,
    beanLabel: 'Sample',
    linkMode: 'none',
    planBatchId: null,
    deductStock: false,
};
const batch = {
    id: 'batch-a',
    plan_id: 'plan-a',
    bean_id: 'bean-a',
    blend_id: null,
    bean_name: 'Coffee',
    batch_size_kg: 1,
    roast_profile_id: null,
    batch_count: 2,
    completed_sessions: 0,
} as PlanBatchWithProgress;

const renderFlow = (patch: Partial<UseRoastSaveFlowParams> = {}) => {
    const root = createRoot(document.createElement('div'));
    roots.add(root);
    const onResetActiveRoast = vi.fn();
    let api: ReturnType<typeof useRoastSaveFlow>;
    const Probe = () => {
        api = useRoastSaveFlow({
            planBatchHandoff: null,
            elapsed: 600,
            rawBT: 200,
            selectedBeanId: null,
            targetProfileId: null,
            handoffBeanName: null,
            sessionId: null,
            onResetActiveRoast,
            ...patch,
        });
        return null;
    };
    const rerender = () => act(() => root.render(createElement(Probe)));
    rerender();
    return {
        get api() {
            return api;
        },
        rerender,
        onResetActiveRoast,
        unmount: () => {
            act(() => root.unmount());
            roots.delete(root);
        },
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.ownerId = 'workspace-a';
    mocks.fetchQuery.mockResolvedValue([]);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.resumeSave.mockImplementation(async (pending: PendingRoastSave) => ({
        syncPending: false,
        savedSession: { id: pending.params.sessionId, plan_batch_id: null },
    }));
    useRoastingStore.getState().reset();
    useRoastingStore.getState().clear();
    useRoastingStore.setState({ sessionOwnerId: null });
    useRoastSessionStore.getState().completeBatch();
});
afterEach(() => {
    act(() => {
        for (const root of roots) root.unmount();
    });
    roots.clear();
    vi.restoreAllMocks();
    useRoastSessionStore.setState({
        planBatchHandoff: null,
        lastAdhocSave: null,
        ...sessionActions,
    });
});

describe('roast save identity and Continue lifecycle', () => {
    it('treats next Charge and Charge-wait as detached from the saved batch', () => {
        expect(
            isLiveDetachedFromPending({ sessionId: 's-b', phase: 'roasting', awaitingNextCharge: false }, 's-a'),
        ).toBe(true);
        expect(isLiveDetachedFromPending({ sessionId: null, phase: 'standby', awaitingNextCharge: true }, 's-a')).toBe(
            true,
        );
        expect(isLiveDetachedFromPending({ sessionId: 's-a', phase: 'ended', awaitingNextCharge: false }, 's-a')).toBe(
            false,
        );
    });

    it('reuses the summary UUID for submission, then generates a distinct UUID for the next unrecorded roast', async () => {
        const h = renderFlow();
        act(() => h.api.confirmEndRoast(summary));
        const firstDraft = listPendingRoastSaves()[0];
        await act(async () => h.api.handleSave(form));
        const first = mocks.resumeSave.mock.calls[0][0] as PendingRoastSave;
        expect(first.params.sessionId).toBe(firstDraft.params.sessionId);
        expect(first.profile).toBe('not_required');
        act(() => h.api.confirmEndRoast(summary));
        await act(async () => h.api.handleSave(form));
        const second = mocks.resumeSave.mock.calls[1][0] as PendingRoastSave;
        expect(second.params.sessionId).toEqual(expect.any(String));
        expect(second.params.sessionId).not.toBe(first.params.sessionId);
        expect(h.onResetActiveRoast).toHaveBeenCalledTimes(2);
    });

    it('keeps both draft and submitted owner bound to the Charge session after workspace changes', async () => {
        useRoastingStore.setState({ sessionOwnerId: 'charge-owner' });
        const h = renderFlow({ sessionId: 'charged-session' });
        mocks.ownerId = 'different-workspace';
        h.rerender();
        act(() => h.api.confirmEndRoast(summary));
        expect(listPendingRoastSaves()[0].params.userId).toBe('charge-owner');
        await act(async () => h.api.handleSave(form));
        expect(mocks.resumeSave.mock.calls[0][0].params).toMatchObject({
            userId: 'charge-owner',
            sessionId: 'charged-session',
        });
    });

    it.each(['workspace', 'unmount'] as const)(
        'never starts a batch when its response arrives after %s change',
        async (change) => {
            let finish = (_row: PlanBatchWithProgress) => {};
            mocks.startForRoast.mockReturnValue(
                new Promise((resolve) => {
                    finish = resolve;
                }),
            );
            const startBatch = vi.spyOn(useRoastSessionStore.getState(), 'startBatch');
            const h = renderFlow();
            let pending = Promise.resolve();
            act(() => {
                pending = h.api.handleStartNext(batch);
            });
            expect(mocks.startForRoast).toHaveBeenCalledExactlyOnceWith('workspace-a', batch);
            if (change === 'workspace') {
                mocks.ownerId = 'workspace-b';
                h.rerender();
            } else h.unmount();
            await act(async () => {
                finish(batch);
                await pending;
            });
            expect(startBatch).not.toHaveBeenCalled();
            expect(useRoastSessionStore.getState().planBatchHandoff).toBeNull();
            expect(mocks.invalidateScheduledBatchQueries).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['workspace', 'unmount'] as const)(
        'does not reset the live roast after %s changes during save',
        async (change) => {
            let finish = () => {};
            mocks.resumeSave.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = () => resolve({ savedSession: { id: 'saved', plan_batch_id: null }, syncPending: false });
                }),
            );
            const h = renderFlow();
            const completeBatch = vi.spyOn(useRoastSessionStore.getState(), 'completeBatch');
            let pending = Promise.resolve();
            act(() => {
                pending = h.api.handleSave(form);
            });
            if (change === 'workspace') {
                mocks.ownerId = 'workspace-b';
                h.rerender();
            } else h.unmount();
            await act(async () => {
                finish();
                await pending;
            });
            expect(h.onResetActiveRoast).not.toHaveBeenCalled();
            expect(completeBatch).not.toHaveBeenCalled();
            expect(mocks.fetchQuery).not.toHaveBeenCalled();
        },
    );

    it('allows only one in-flight Continue start and accepts the next start after completion', async () => {
        let finish = (_row: PlanBatchWithProgress) => {};
        mocks.startForRoast
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                }),
            )
            .mockResolvedValue(batch);
        const startBatch = vi.spyOn(useRoastSessionStore.getState(), 'startBatch');
        const h = renderFlow();
        let first = Promise.resolve();
        let second = Promise.resolve();
        act(() => {
            first = h.api.handleStartNext(batch);
            second = h.api.handleStartNext(batch);
        });
        expect(mocks.startForRoast).toHaveBeenCalledTimes(1);
        await act(async () => {
            finish(batch);
            await Promise.all([first, second]);
        });
        expect(startBatch).toHaveBeenCalledTimes(1);
        await act(async () => h.api.handleStartNext(batch));
        expect(mocks.startForRoast).toHaveBeenCalledTimes(2);
        expect(startBatch).toHaveBeenCalledTimes(2);
    });

    it('closes the save modal before waiting for next-batch fetch', async () => {
        let finishFetch = () => {};
        mocks.fetchQuery.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishFetch = () => resolve([]);
                }),
        );
        const h = renderFlow();
        act(() => h.api.confirmEndRoast(summary));
        expect(h.api.flow.summaryModal).toBe(true);
        let pending = Promise.resolve();
        await act(async () => {
            pending = h.api.handleSave(form);
            await vi.waitFor(() => {
                expect(mocks.fetchQuery).toHaveBeenCalled();
            });
        });
        expect(h.api.flow.summaryModal).toBe(false);
        expect(h.api.flow.continueModal).toBe(false);
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
        expect(mocks.fetchQuery).toHaveBeenCalled();
        const completeBatch = vi.spyOn(useRoastSessionStore.getState(), 'completeBatch');
        await act(async () => {
            finishFetch();
            await pending;
        });
        expect(h.api.flow.continueModal).toBe(false);
        expect(completeBatch).toHaveBeenCalled();
        expect(h.onResetActiveRoast).toHaveBeenCalledTimes(1);
    });

    it('opens continue only after fresh remaining batches resolve', async () => {
        let finishFetch = () => {};
        mocks.fetchQuery.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishFetch = () => resolve([batch]);
                }),
        );
        const h = renderFlow();
        act(() => h.api.confirmEndRoast(summary));
        let pending = Promise.resolve();
        await act(async () => {
            pending = h.api.handleSave(form);
            await vi.waitFor(() => {
                expect(mocks.fetchQuery).toHaveBeenCalled();
            });
        });
        expect(h.api.flow.summaryModal).toBe(false);
        expect(h.api.flow.continueModal).toBe(false);
        expect(h.api.flow.continueCandidates).toEqual([]);
        await act(async () => {
            finishFetch();
            await pending;
        });
        expect(h.api.flow.continueModal).toBe(true);
        expect(h.api.flow.continueCandidates).toEqual([batch]);
        expect(h.onResetActiveRoast).toHaveBeenCalledTimes(1);
    });

    it('Drop confirm keeps live schedule handoff for Charge B', () => {
        const h = renderFlow({ sessionId: 's-a' });
        act(() => sessionActions.startBatch(handoffB));
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        expect(useRoastSessionStore.getState().planBatchHandoff?.planBatchId).toBe('batch-b');
    });

    it('late save without pending reconstructs from frozen summary, not live B', async () => {
        const h = renderFlow({ sessionId: 's-a', selectedBeanId: 'bean-a', planBatchHandoff: null });
        act(() =>
            h.api.confirmEndRoast({
                ...summary,
                sessionId: 's-a',
                selectedBeanId: 'bean-a',
                elapsedSec: 600,
                planBatchHandoff: null,
            }),
        );
        clearPendingRoastSave('workspace-a', 's-a');
        act(() => {
            sessionActions.startBatch(handoffB);
            useRoastingStore.setState({
                phase: 'roasting',
                sessionId: 's-b',
                elapsed: 12,
                awaitingNextCharge: false,
            });
        });
        await act(async () =>
            h.api.handleSave({ ...form, beanId: 'bean-a', linkMode: 'schedule', planBatchId: 'batch-a' }),
        );
        const saved = mocks.resumeSave.mock.calls[0][0] as PendingRoastSave;
        expect(saved.params.sessionId).toBe('s-a');
        expect(saved.params.elapsed).toBe(600);
        expect(saved.params.planBatchHandoff).toBeNull();
        expect(saved.params.formData.linkedBatchId).toBe('batch-a');
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
    });

    it('late A save does not reset in-progress B or swap handoff', async () => {
        const h = renderFlow({ sessionId: 's-a', selectedBeanId: 'bean-a' });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a', selectedBeanId: 'bean-a' }));
        act(() => {
            sessionActions.startBatch(handoffB);
            useRoastingStore.setState({
                phase: 'roasting',
                sessionId: 's-b',
                awaitingNextCharge: false,
            });
        });
        expect(listPendingRoastSaves()[0].params.sessionId).toBe('s-a');
        expect(useRoastingStore.getState().sessionId).toBe('s-b');
        const completeBatch = vi.fn();
        useRoastSessionStore.setState({ completeBatch });
        await act(async () => h.api.handleSave({ ...form, beanId: 'bean-a' }));
        expect(mocks.resumeSave.mock.calls[0][0].params.sessionId).toBe('s-a');
        expect(mocks.resumeSave.mock.calls[0][0].params.selectedBeanId).toBe('bean-a');
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
        expect(completeBatch).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().sessionId).toBe('s-b');
        expect(useRoastSessionStore.getState().planBatchHandoff?.planBatchId).toBe('batch-b');
    });

    it('keeps batch A start time when batch B is charged before A is saved', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
        try {
            const startA = Date.now();
            useRoastingStore.setState({
                phase: 'roasting',
                roastStartMs: startA,
                sessionId: 's-a',
                sessionOwnerId: 'workspace-a',
                elapsed: 600,
            });
            const h = renderFlow({ sessionId: 's-a', elapsed: 600 });
            act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a', elapsedSec: 600 }));
            expect(listPendingRoastSaves()[0]?.params.roastStartTime).toBe(startA);

            vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
            useRoastingStore.getState().reset();
            useRoastingStore.getState().startCharge();
            const startB = useRoastingStore.getState().roastStartMs;
            const sessionB = useRoastingStore.getState().sessionId;
            expect(startB).toBe(Date.now());
            expect(startB).not.toBe(startA);

            await act(async () => h.api.handleSave({ ...form, beanId: 'bean-a' }));
            expect(mocks.resumeSave.mock.calls[0][0].params.roastStartTime).toBe(startA);
            expect(mocks.resumeSave.mock.calls[0][0].params.sessionId).toBe('s-a');
            expect(useRoastingStore.getState().roastStartMs).toBe(startB);
            expect(useRoastingStore.getState().sessionId).toBe(sessionB);

            vi.setSystemTime(Date.now() + 60_000);
            await act(async () => h.api.handleSave({ ...form, beanId: 'bean-a' }));
            expect(mocks.resumeSave).toHaveBeenCalledTimes(1);
            expect(useRoastingStore.getState().roastStartMs).toBe(startB);
            expect(useRoastingStore.getState().sessionId).toBe(sessionB);
        } finally {
            vi.useRealTimers();
        }
    });

    it('save during Drop Charge-wait does not wipe the next-batch machine state', async () => {
        const h = renderFlow({ sessionId: 's-a' });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        useRoastingStore.setState({ phase: 'standby', sessionId: null, awaitingNextCharge: true });
        const completeBatch = vi.fn();
        useRoastSessionStore.setState({ completeBatch });
        await act(async () => h.api.handleSave(form));
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
        expect(completeBatch).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
        expect(mocks.fetchQuery).not.toHaveBeenCalled();
    });
});

it.each(['success', 'failure'] as const)(
    'keeps B summary, checkpoint, restore and lock when A resolves with %s',
    async (outcome) => {
        let resolveSave = (_value: unknown) => {};
        let rejectSave = (_error: Error) => {};
        mocks.resumeSave.mockImplementationOnce(
            () =>
                new Promise((resolve, reject) => {
                    resolveSave = resolve;
                    rejectSave = reject;
                }),
        );
        const h = renderFlow({ sessionId: 's-a' });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        let pending = Promise.resolve();
        act(() => {
            pending = h.api.handleSave(form);
        });
        const restoreB = {
            sessionId: 's-b',
            sessionOwnerId: 'workspace-a',
            roastStartMs: Date.now() - 60_000,
            elapsed: 60,
            logEntries: [],
            livePoints: [],
        };
        act(() => {
            useRoastingStore.setState({
                phase: 'standby',
                sessionId: null,
                awaitingNextCharge: true,
                heatHoldAfterDrop: true,
            });
            useRoastingStore.getState().capture(restoreB);
            h.api.confirmEndRoast({ ...summary, sessionId: 's-b', selectedBeanId: 'bean-b', elapsedSec: 60 });
        });
        const frozenB = h.api.flow.summaryData;
        const recordB = useRoastingStore.getState().completedRecords[completedKey('workspace-a', 's-b')];
        await act(async () => {
            if (outcome === 'success')
                resolveSave({ syncPending: false, savedSession: { id: 's-a', plan_batch_id: null } });
            else rejectSave(new Error('A failed'));
            await pending;
        });
        expect(h.api.flow.summaryData).toBe(frozenB);
        expect(h.api.flow.summaryModal).toBe(true);
        expect(h.api.isSaving).toBe(false);
        expect(useRoastingStore.getState().completedRecords[completedKey('workspace-a', 's-b')]).toBe(recordB);
        expect(listPendingRoastSaves().find((p) => p.params.sessionId === 's-b')?.params.selectedBeanId).toBe('bean-b');
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
    },
);
