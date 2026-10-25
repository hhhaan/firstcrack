// @vitest-environment jsdom
import { roastSessionKeys, useRoastSession, useUpdateRoastRecord } from '@entities/roast';
import type { roastSessionApi } from '@entities/roast/api';
import { serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { Json, RoastSessionWithRelations } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendReviewEntry, useReviewCurveEdit } from './useReviewCurveEdit';

type Saved = { events: Json; heater_events: Json | null };
type RecordRow = RoastSessionWithRelations;
const workspace = vi.hoisted(() => ({ owner: 'owner' }));
const records = vi.hoisted(() => new Map<string, RecordRow>());
const update = vi.hoisted(() =>
    vi.fn<(payload: Parameters<typeof roastSessionApi.updateRecord>[0]) => Promise<Saved>>(),
);

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: workspace.owner, isWorkspaceReady: true }),
}));
vi.mock('@entities/roast/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/roast/api')>();
    return {
        ...actual,
        roastSessionApi: {
            ...actual.roastSessionApi,
            get: vi.fn(async (id: string) => {
                const row = records.get(id);
                if (!row) throw new Error('Missing record');
                return row;
            }),
            updateRecord: update,
        },
    };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('saved snapshot event changes', () => {
    let root: Root;
    let qc: QueryClient;
    let history: ReturnType<typeof useRoastSession>;
    let historyEdit: ReturnType<typeof useUpdateRoastRecord>;
    let api: ReturnType<typeof useReviewCurveEdit> | undefined;
    const Probe = ({ id }: { id: string | null }) => {
        const value = useReviewCurveEdit(id);
        history = useRoastSession(workspace.owner, id ?? '');
        historyEdit = useUpdateRoastRecord(workspace.owner);
        useLayoutEffect(() => {
            api = value;
        });
        return null;
    };
    const render = (id: string | null) =>
        act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe, { id }))));
    const capturedLog = () => selectReviewSnapshot(useRoastingStore.getState())?.logEntries ?? [];
    const reviewLog = () => api?.getReviewLog() ?? [];
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
            ambient_humidity_pct: null,
            ambient_temp_celsius: null,
            batch_name: null,
            bbp_seconds: null,
            bbp_tsv_path: null,
            bean_id: null,
            bean_label: null,
            blend_id: null,
            color_ground: null,
            color_whole: null,
            created_at: '',
            created_by: null,
            density_g_per_l: null,
            machine_brand: null,
            machine_id: null,
            machine_name: null,
            machine_protocol: null,
            machine_roaster_key: null,
            moisture_pct: null,
            notes: null,
            output_weight_grams: null,
            plan_batch_id: null,
            profile_batch_number: null,
            profile_id: null,
            roast_level: null,
            roasted_at: null,
            scheduled_at: null,
            status: 'completed',
            total_batch_number: null,
            tsv_path: null,
            updated_at: '',
            user_id: workspace.owner,
            weight_grams: 1000,
            beans: null,
            roast_profiles: null,
            id,
            events: [{ id: 'bbp', type: 'Note', time_sec: -60, note: 'keep' }, ...serializeRoastEvents(capturedLog())],
            heater_events: null,
            duration_seconds: 600,
            drop_temp_celsius: 200,
            charge_temp_celsius: 180,
        });
        qc.setQueryData(roastSessionKeys.detail(workspace.owner, id), records.get(id));
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
        update.mockImplementation(async (value) => {
            const row = records.get(value.sessionId);
            if (!row) throw new Error('Missing record');
            const saved = { ...row, events: value.events, heater_events: value.heaterEvents };
            records.set(row.id, saved);
            return saved;
        });
        qc = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
        });
        useRoastingStore.getState().reset();
        root = createRoot(document.createElement('div'));
        api = undefined;
    });
    afterEach(() => {
        act(() => root.unmount());
        useRoastingStore.getState().reset();
        qc.clear();
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
        await act(async () => {
            await Promise.resolve();
        });
        expect(update).toHaveBeenCalledTimes(1);
        await act(async () => {
            if (fail) reject?.(new Error('offline'));
            else {
                const row = records.get(id);
                if (!row) throw new Error('Missing row');
                const saved = { ...row, events: payload(0).events, heater_events: null };
                records.set(id, saved);
                finish?.(saved);
            }
        });
        expect(update).toHaveBeenCalledTimes(2);
        expect(payload(1).events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'bbp', note: 'keep' }),
                expect.objectContaining({ type: 'Note', note: 'first' }),
                expect.objectContaining({ type: 'Note', note: 'second' }),
            ]),
        );
        expect(payload(1).expectedEvents).toEqual(
            fail
                ? [{ id: 'bbp', type: 'Note', time_sec: -60, note: 'keep' }, ...serializeRoastEvents(capturedLog())]
                : payload(0).events,
        );
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
        await act(async () => addNote('A'));
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
        qc.removeQueries({ queryKey: roastSessionKeys.detail(workspace.owner, id) });
        render(id);
        act(() => addNote('first'));
        act(() => addNote('second'));
        expect(update).not.toHaveBeenCalled();
        records.set(id, record);
        await act(async () => {
            qc.setQueryData(roastSessionKeys.detail(workspace.owner, id), record);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(payload(0).events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'bbp', note: 'keep' }),
                expect.objectContaining({ note: 'first' }),
                expect.objectContaining({ note: 'second' }),
            ]),
        );
    });
    const flush = () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    const rowFor = (id: string) => {
        const row = records.get(id);
        if (!row) throw new Error('Missing saved row');
        return row;
    };
    const seedRecord = (id: string, patch: Partial<RecordRow>) => {
        const row = { ...rowFor(id), ...patch };
        records.set(id, row);
        qc.setQueryData(roastSessionKeys.detail(workspace.owner, id), row);
        return row;
    };
    const saveFromHistory = async (events: Json, heaterEvents: Json | null) => {
        const row = history.data;
        if (!row) throw new Error('Missing History row');
        await act(async () =>
            historyEdit.mutateAsync({
                sessionId: row.id,
                expectedEvents: row.events,
                expectedHeaterEvents: row.heater_events,
                events,
                heaterEvents,
                dropTempCelsius: row.drop_temp_celsius,
                durationSeconds: row.duration_seconds,
                profileSummary: null,
            }),
        );
        await flush();
    };

    it('shows the same accepted events and Heat set in both consumers after a rejected edit', async () => {
        const id = openReview();
        const accepted = seedRecord(id, {
            events: [
                ...serializeRoastEvents(capturedLog()),
                { id: 'heat', type: 'Heater', time_sec: 30, temp_c: 160, note: '80%' },
            ],
            heater_events: [{ t: 30, bt: 160, heater: 80 }],
        });
        let reject: ((error: Error) => void) | undefined;
        update.mockImplementationOnce(
            () =>
                new Promise<Saved>((_resolve, onReject) => {
                    reject = onReject;
                }),
        );
        render(id);
        const captured = useRoastingStore.getState().completed?.snapshot;
        await act(async () =>
            api?.applyReviewLog(
                reviewLog().map((entry) => (entry.id === 'heat' ? { ...entry, note: '50%', timeSec: 45 } : entry)),
            ),
        );
        await flush();
        expect(api?.reviewLogEntries).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'heat', note: '50%', timeSec: 45 })]),
        );
        expect(history.data?.heater_events).toEqual([{ t: 45, bt: 160, heater: 50 }]);
        expect(api?.reviewHeaterEvents).toEqual(history.data?.heater_events);
        await act(async () => reject?.(new Error('offline')));
        await flush();
        expect(history.data?.events).toEqual(accepted.events);
        expect(api?.reviewLogEntries).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'heat', note: '80%', timeSec: 30 })]),
        );
        expect(api?.reviewHeaterEvents).toEqual(accepted.heater_events);
        expect(api?.reviewHeaterEvents).toEqual(history.data?.heater_events);
        expect(api?.reviewSaveError).toBe('history.edit.saveFailed');
        expect(useRoastingStore.getState().completed?.snapshot).toBe(captured);
    });

    it('reads History edit/add/delete and preserves its Heat set, BBP, unknown fields, and Control rows in the next snapshot edit', async () => {
        const id = openReview();
        seedRecord(id, {
            events: [
                ...serializeRoastEvents(capturedLog()),
                { id: 'note', type: 'Note', time_sec: 120, note: 'old' },
                { id: 'bbp', type: 'Note', time_sec: -60, note: 'soak', unknown: { keep: true } },
                {
                    id: 'control',
                    type: 'Control',
                    time_sec: 40,
                    applied_control: { fan: 35, drum: 40 },
                    extra: 'keep',
                },
                { id: 'bbp-heat', type: 'Heater', time_sec: -40, note: '90%' },
                { id: 'bbp-control', type: 'Control', time_sec: -20, applied_control: { fan: 70 } },
                { id: 'future', type: 'FutureEvent', time_sec: 200, extra: 'keep' },
                { id: 'heat', type: 'Heater', time_sec: 30, temp_c: 160, note: '80%' },
            ],
        });
        render(id);
        const first = rowFor(id);
        const changed = Array.isArray(first.events)
            ? first.events.map((event) =>
                  event && typeof event === 'object' && !Array.isArray(event) && event.id === 'note'
                      ? { ...event, note: 'History correction' }
                      : event,
              )
            : [];
        const added = { id: 'added', type: 'Note', time_sec: 140, note: 'History add' };
        const plan = [{ t: 30, bt: 160, heater: 55 }];
        await saveFromHistory([...changed, added], plan);
        expect(api?.reviewLogEntries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'note', note: 'History correction' }),
                expect.objectContaining({ id: 'added', note: 'History add' }),
                expect.objectContaining({ id: 'control', appliedControl: { fan: 35, drum: 40 } }),
            ]),
        );
        expect(api?.reviewHeaterEvents).toEqual(plan);
        expect(api?.reviewLogEntries?.some((entry) => entry.id?.startsWith('bbp'))).toBe(false);
        await saveFromHistory(changed, plan);
        expect(api?.reviewLogEntries?.some((entry) => entry.id === 'added')).toBe(false);
        await act(async () => addNote('snapshot add'));
        await flush();
        expect(payload(2).expectedEvents).toEqual(changed);
        expect(payload(2).expectedHeaterEvents).toEqual(plan);
        expect(payload(2).heaterEvents).toEqual(plan);
        expect(payload(2).events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'note', note: 'History correction' }),
                { id: 'bbp', type: 'Note', time_sec: -60, note: 'soak', unknown: { keep: true } },
                {
                    id: 'control',
                    type: 'Control',
                    time_sec: 40,
                    applied_control: { fan: 35, drum: 40 },
                    extra: 'keep',
                },
                { id: 'bbp-heat', type: 'Heater', time_sec: -40, note: '90%' },
                { id: 'bbp-control', type: 'Control', time_sec: -20, applied_control: { fan: 70 } },
                { id: 'future', type: 'FutureEvent', time_sec: 200, extra: 'keep' },
                expect.objectContaining({ note: 'snapshot add' }),
            ]),
        );
        expect(api?.reviewLogEntries).toEqual(
            expect.arrayContaining([expect.objectContaining({ note: 'snapshot add' })]),
        );
        expect(history.data?.events).toEqual(payload(2).events);
    });

    it('returns to the accepted cache when the final queued edit also fails', async () => {
        const id = openReview();
        const accepted = rowFor(id);
        let reject: ((error: Error) => void) | undefined;
        update.mockImplementationOnce(
            () =>
                new Promise<Saved>((_resolve, onReject) => {
                    reject = onReject;
                }),
        );
        update.mockRejectedValueOnce(new Error('offline again'));
        render(id);
        act(() => addNote('first'));
        act(() => addNote('second'));
        await flush();
        await act(async () => reject?.(new Error('offline')));
        await flush();
        expect(update).toHaveBeenCalledTimes(2);
        expect(api?.reviewLogEntries?.some((entry) => entry.note === 'first' || entry.note === 'second')).toBe(false);
        expect(history.data?.events).toEqual(accepted.events);
        expect(api?.reviewHeaterEvents).toEqual(history.data?.heater_events);
    });
    it('drops queued old-review intent when the next Charge takes ownership before settlement', async () => {
        const id = openReview();
        let reject: ((error: Error) => void) | undefined;
        update.mockImplementationOnce(
            () =>
                new Promise<Saved>((_resolve, onReject) => {
                    reject = onReject;
                }),
        );
        render(id);
        act(() => addNote('in flight'));
        act(() => addNote('queued'));
        await flush();
        let next: string | null = null;
        act(() => {
            next = useRoastingStore.getState().startCharge(undefined, workspace.owner);
        });
        render(null);
        const live = useRoastingStore.getState();
        expect(next).not.toBe(id);
        expect(selectReviewSnapshot(live)).toBeNull();
        await act(async () => reject?.(new Error('late failure')));
        await flush();
        expect(update).toHaveBeenCalledTimes(1);
        expect(useRoastingStore.getState().sessionId).toBe(next);
        expect(useRoastingStore.getState().logState).toBe(live.logState);
        expect(useRoastingStore.getState().livePoints).toBe(live.livePoints);
        expect(api?.reviewSaveError).toBeNull();
        expect(api?.reviewHeaterEvents).toBeNull();
    });
});
