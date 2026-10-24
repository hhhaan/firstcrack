// @vitest-environment jsdom
import type { roastSessionApi } from '@entities/roast/api';
import { serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { Json } from '@shared/types/database.types';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendReviewEntry, useReviewCurveEdit } from './useReviewCurveEdit';

type Saved = { events: Json; heater_events: Json | null };
type RecordRow = Saved & {
    id: string;
    duration_seconds: number;
    drop_temp_celsius: number;
    charge_temp_celsius: number;
};
const workspace = vi.hoisted(() => ({ owner: 'owner' }));
const records = vi.hoisted(() => new Map<string, RecordRow>());
const update = vi.hoisted(() =>
    vi.fn<(payload: Parameters<typeof roastSessionApi.updateRecord>[0]) => Promise<Saved>>(),
);

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: workspace.owner, isWorkspaceReady: true }),
}));
vi.mock('@entities/roast', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/roast')>();
    return {
        ...actual,
        useRoastSession: (_owner: string, id: string) => ({ data: records.get(id) }),
        useUpdateRoastRecord: () => ({ mutateAsync: update }),
    };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('saved snapshot event changes', () => {
    let root: Root;
    let api: ReturnType<typeof useReviewCurveEdit> | undefined;
    const Probe = ({ id }: { id: string | null }) => {
        const value = useReviewCurveEdit(id);
        useLayoutEffect(() => {
            api = value;
        });
        return null;
    };
    const render = (id: string | null) => act(() => root.render(createElement(Probe, { id })));
    const reviewLog = () => selectReviewSnapshot(useRoastingStore.getState())?.logEntries ?? [];
    const addNote = (note: string) => {
        if (!api) throw new Error('Missing review hook');
        api.applyReviewLog(appendReviewEntry(reviewLog(), 'Note', note, 120, 160, 'C'));
    };
    const openReview = () => {
        const state = useRoastingStore.getState();
        state.prepareWorkspace(workspace.owner);
        const id = state.startCharge(undefined, workspace.owner);
        if (!id) throw new Error('Missing session');
        useRoastingStore.setState({ elapsed: 600 });
        state.abortRoast(200, 'C');
        state.saveSucceeded(workspace.owner, id);
        records.set(id, {
            id,
            events: [{ id: 'bbp', type: 'Note', time_sec: -60, note: 'keep' }, ...serializeRoastEvents(reviewLog())],
            heater_events: null,
            duration_seconds: 600,
            drop_temp_celsius: 200,
            charge_temp_celsius: 180,
        });
        return id;
    };
    const payload = (index: number) => {
        const value = update.mock.calls[index]?.[0];
        if (!value) throw new Error('Missing saved-record request');
        return value;
    };

    beforeEach(() => {
        workspace.owner = 'owner';
        records.clear();
        update.mockReset();
        update.mockImplementation(async (value) => ({ events: value.events, heater_events: value.heaterEvents }));
        useRoastingStore.getState().reset();
        root = createRoot(document.createElement('div'));
        api = undefined;
    });
    afterEach(() => {
        act(() => root.unmount());
        useRoastingStore.getState().reset();
    });

    it.each([false, true])('keeps queued edits and unseen BBP when the first request fails=%s', async (fail) => {
        let finish: ((value: Saved) => void) | undefined;
        let reject: ((error: Error) => void) | undefined;
        update.mockImplementationOnce(
            () =>
                new Promise<Saved>((resolve, onReject) => {
                    finish = resolve;
                    reject = onReject;
                }),
        );
        const id = openReview();
        render(id);
        act(() => addNote('first'));
        act(() => addNote('second'));
        expect(update).toHaveBeenCalledTimes(1);
        await act(async () => {
            if (fail) reject?.(new Error('offline'));
            else finish?.({ events: payload(0).events, heater_events: null });
        });
        expect(update).toHaveBeenCalledTimes(2);
        expect(payload(1).events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'bbp', note: 'keep' }),
                expect.objectContaining({ type: 'Note', note: 'first' }),
                expect.objectContaining({ type: 'Note', note: 'second' }),
            ]),
        );
        expect(payload(1).expectedEvents).toEqual(fail ? records.get(id)?.events : payload(0).events);
        expect(api?.reviewSaveError).toBeNull();
    });

    it.each([false, true])('ignores a late response after the review changes workspace=%s', async (changeOwner) => {
        let finish: ((value: Saved) => void) | undefined;
        update.mockImplementationOnce(
            () =>
                new Promise<Saved>((resolve) => {
                    finish = resolve;
                }),
        );
        const first = openReview();
        render(first);
        act(() => addNote('A'));
        if (changeOwner) workspace.owner = 'other-owner';
        let second = '';
        act(() => {
            second = openReview();
        });
        render(second);
        await act(async () => addNote('B'));
        const before = useRoastingStore.getState().completed;
        await act(async () => finish?.({ events: payload(0).events, heater_events: [{ t: 1, bt: 150, heater: 99 }] }));
        expect(useRoastingStore.getState().completed).toBe(before);
        expect(api?.reviewHeaterEvents).toBeNull();
        await act(async () => addNote('C'));
        expect(payload(2).sessionId).toBe(second);
        expect(payload(2).expectedEvents).toEqual(payload(1).events);
        expect(payload(2).events).not.toEqual(expect.arrayContaining([expect.objectContaining({ note: 'A' })]));
    });

    it('retains edits queued before the saved record loads', async () => {
        const id = openReview();
        const record = records.get(id);
        if (!record) throw new Error('Missing record');
        records.delete(id);
        render(id);
        act(() => addNote('first'));
        act(() => addNote('second'));
        expect(update).not.toHaveBeenCalled();
        records.set(id, record);
        await act(async () => render(id));
        expect(payload(0).events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'bbp', note: 'keep' }),
                expect.objectContaining({ note: 'first' }),
                expect.objectContaining({ note: 'second' }),
            ]),
        );
    });
});
