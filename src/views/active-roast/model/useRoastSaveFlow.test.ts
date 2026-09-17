// @vitest-environment jsdom
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { listPendingRoastSaves, type PendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type UseRoastSaveFlowParams, useRoastSaveFlow } from './useRoastSaveFlow';

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
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

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
            roastStartTimeRef: { current: 0 },
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
    useRoastingStore.setState({ sessionOwnerId: null });
    useRoastSessionStore.getState().completeBatch();
});
afterEach(() => {
    act(() => {
        for (const root of roots) root.unmount();
    });
    roots.clear();
    vi.restoreAllMocks();
});

describe('roast save identity and Continue lifecycle', () => {
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
});
