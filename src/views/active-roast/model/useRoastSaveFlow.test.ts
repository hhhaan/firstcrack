// @vitest-environment jsdom

import { assertGreenBeanSelectedForSave } from '@features/active-roast/lib/roastSaveBeanIdentity';
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import {
    clearPendingRoastSave,
    listPendingRoastSaves,
    type PendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLiveDetachedFromPending, type UseRoastSaveFlowParams, useRoastSaveFlow } from './useRoastSaveFlow';

const sessionActions = {
    startBatch: useRoastingStore.getState().startBatch,
    completeBatch: useRoastingStore.getState().completeBatch,
    recordAdhocSave: useRoastingStore.getState().recordAdhocSave,
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

type FlowFixture = Partial<UseRoastSaveFlowParams> & {
    planBatchHandoff?: PlanBatchHandoff | null;
    elapsed?: number;
    selectedBeanId?: string | null;
    targetProfileId?: string | null;
    handoffBeanName?: string | null;
    sessionId?: string | null;
};
const renderFlow = (patch: FlowFixture = {}) => {
    const state = useRoastingStore.getState();
    const selection = {
        beanId: patch.selectedBeanId ?? null,
        beanName: patch.handoffBeanName ?? null,
        profileId: patch.targetProfileId ?? null,
        planBatchHandoff: patch.planBatchHandoff ?? null,
    };
    useRoastingStore.setState({
        elapsed: patch.elapsed ?? 600,
        ...(patch.sessionId !== undefined && { sessionId: patch.sessionId }),
        prepared: { ...state.prepared, ...selection },
        activeSelection: state.activeSelection ? { ...state.activeSelection, ...selection } : null,
    });
    const root = createRoot(document.createElement('div'));
    roots.add(root);
    const onResetActiveRoast = vi.fn();
    let api: ReturnType<typeof useRoastSaveFlow>;
    const Probe = () => {
        api = useRoastSaveFlow({
            rawBT: 200,
            onResetActiveRoast,
            ...(patch.rawBT !== undefined && { rawBT: patch.rawBT }),
            ambientTemperature: patch.ambientTemperature,
            ambientHumidity: patch.ambientHumidity,
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
    useRoastingStore.setState({ sessionOwnerId: null });
    useRoastingStore.getState().completeBatch();
});
afterEach(() => {
    act(() => {
        for (const root of roots) root.unmount();
    });
    roots.clear();
    vi.restoreAllMocks();
    useRoastingStore.setState({
        prepared: { ...useRoastingStore.getState().prepared, planBatchHandoff: null },
        lastAdhocSave: null,
        ...sessionActions,
    });
});

describe('roast save identity and Continue lifecycle', () => {
    it('keeps the frozen header separate from a form-only selection after a failed save', async () => {
        const h = renderFlow({ sessionId: 's-a' });
        mocks.resumeSave.mockRejectedValueOnce(new Error('network'));
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        await act(async () => h.api.handleSave({ ...form, beanId: 'form-picked' }));
        const pending = listPendingRoastSaves().find((p) => p.params.sessionId === 's-a');
        expect(pending?.params.formData.beanId).toBe('form-picked');
        expect(pending?.params.selectedBeanId).toBeNull();
        if (!pending) throw new Error('Missing pending roast');
        expect(() =>
            assertGreenBeanSelectedForSave({
                ...pending.params,
                formData: { ...pending.params.formData, beanId: null, beanLabel: '' },
            }),
        ).toThrow();
    });
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

    it('blocks save without a green bean before resumeSave and does not capture Sentry', async () => {
        const h = renderFlow({ sessionId: 's-a' });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        await act(async () =>
            h.api.handleSave({
                ...form,
                beanId: null,
                beanLabel: '',
                weightGrams: 5,
            }),
        );
        expect(mocks.resumeSave).not.toHaveBeenCalled();
        expect(logger.capture).not.toHaveBeenCalled();
        expect(mocks.message).toHaveBeenCalled();
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

    it('summary save omits roast color fields from pending checkpoint and RPC payload', async () => {
        const sessionId = '11111111-1111-4111-8111-111111111111';
        const h = renderFlow({ sessionId });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId }));
        await act(async () => h.api.handleSave(form));
        const saved = mocks.resumeSave.mock.calls[0][0] as PendingRoastSave;
        expect(saved.params.formData).not.toHaveProperty('colorWhole');
        expect(saved.params.formData).not.toHaveProperty('colorGround');
        const checkpoint = listPendingRoastSaves().find((p) => p.params.sessionId === sessionId);
        expect(checkpoint?.params.formData).not.toHaveProperty('colorWhole');
        expect(checkpoint?.params.formData).not.toHaveProperty('colorGround');
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
            const startBatch = vi.spyOn(useRoastingStore.getState(), 'startBatch');
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
            expect(useRoastingStore.getState().prepared.planBatchHandoff).toBeNull();
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
            const completeBatch = vi.spyOn(useRoastingStore.getState(), 'completeBatch');
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
        const startBatch = vi.spyOn(useRoastingStore.getState(), 'startBatch');
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
        const completeBatch = vi.spyOn(useRoastingStore.getState(), 'completeBatch');
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
        expect(useRoastingStore.getState().prepared.planBatchHandoff?.planBatchId).toBe('batch-b');
    });

    it('late save without pending reconstructs from frozen summary, not live B', async () => {
        const h = renderFlow({ sessionId: 's-a', selectedBeanId: 'bean-a', planBatchHandoff: null });
        act(() =>
            h.api.confirmEndRoast({
                ...summary,
                sessionId: 's-a',
                selectedBeanId: 'bean-a',
                elapsedSec: 600,
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
        useRoastingStore.setState({ completeBatch });
        await act(async () => h.api.handleSave({ ...form, beanId: 'bean-a' }));
        expect(mocks.resumeSave.mock.calls[0][0].params.sessionId).toBe('s-a');
        expect(mocks.resumeSave.mock.calls[0][0].params.selectedBeanId).toBe('bean-a');
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
        expect(completeBatch).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().sessionId).toBe('s-b');
        expect(useRoastingStore.getState().prepared.planBatchHandoff?.planBatchId).toBe('batch-b');
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
            });
            const h = renderFlow({ sessionId: 's-a', elapsed: 600 });
            act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a', elapsedSec: 600 }));
            expect(listPendingRoastSaves()[0]?.params.roastStartTime).toBe(startA);

            vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
            useRoastingStore.getState().resetCurrentBatch();
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
        useRoastingStore.setState({ completeBatch });
        await act(async () => h.api.handleSave(form));
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
        expect(completeBatch).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
        expect(mocks.fetchQuery).not.toHaveBeenCalled();
    });
});

describe('completed batch identity at asynchronous and recovery boundaries', () => {
    it('late A save leaves the new B summary open and recoverable', async () => {
        let finish: (result: { syncPending: boolean; savedSession: { id: string; plan_batch_id: null } }) => void =
            () => {};
        mocks.resumeSave.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const h = renderFlow({ sessionId: 's-a', selectedBeanId: 'bean-a' });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        let saving: Promise<void> = Promise.resolve();
        act(() => {
            saving = h.api.handleSave(form);
        });
        const nextId = useRoastingStore.getState().startCharge(undefined, 'workspace-a');
        if (!nextId) throw new Error('B did not Charge');
        act(() => {
            const completed = useRoastingStore.getState().drop({ rawBT: 205, unit: 'C', replayActive: false });
            if (!completed) throw new Error('B did not Drop');
            h.api.confirmEndRoast(completed.summary);
        });
        expect(h.api.flow.summaryModal).toBe(true);
        await act(async () => {
            finish({ syncPending: false, savedSession: { id: 's-a', plan_batch_id: null } });
            await saving;
        });
        expect(h.api.flow.summaryData?.sessionId).toBe(nextId);
        expect(h.api.flow.summaryModal).toBe(true);
        expect(listPendingRoastSaves().some((draft) => draft.params.sessionId === nextId)).toBe(true);
        expect(h.onResetActiveRoast).not.toHaveBeenCalled();
    });
    it('checkpoint failure and remount retain the original snapshot for retry', async () => {
        const h = renderFlow({ sessionId: 's-a', selectedBeanId: 'bean-a', targetProfileId: 'profile-a' });
        const storage = vi.spyOn(Storage.prototype, 'setItem');
        storage.mockImplementationOnce(() => {
            throw new Error('Storage quota exceeded');
        });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        expect(listPendingRoastSaves()).toHaveLength(0);
        expect(h.api.flow.summaryData?.sessionId).toBe('s-a');
        h.unmount();
        const recovered = renderFlow({ selectedBeanId: 'next-bean', targetProfileId: 'next-profile' });
        act(() => recovered.api.flow.reopenSummary());
        expect(recovered.api.flow.summaryModal).toBe(true);
        await act(async () => recovered.api.handleSave(form));
        expect(mocks.resumeSave.mock.calls[0][0].params).toMatchObject({
            sessionId: 's-a',
            selectedBeanId: 'bean-a',
            targetProfileId: 'profile-a',
            elapsed: 600,
        });
    });
});

describe('explicit discard is scoped to the visible summary', () => {
    it('an old A discard callback cannot delete the new B checkpoint or summary', () => {
        const h = renderFlow({ sessionId: 's-a' });
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-a' }));
        const discardA = h.api.discardSummary;
        act(() => h.api.confirmEndRoast({ ...summary, sessionId: 's-b' }));
        act(() => discardA());
        expect(h.api.flow.summaryData?.sessionId).toBe('s-b');
        expect(h.api.flow.summaryModal).toBe(true);
        expect(listPendingRoastSaves().some((pending) => pending.params.sessionId === 's-b')).toBe(true);
    });
});
