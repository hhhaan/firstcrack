// @vitest-environment jsdom
import { TP_MARKER_ID } from '@features/active-roast/lib/constants';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastCurveEditing } from './useRoastCurveEditing';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

const entry = (id: string, event: string, timeSec: number): LogEntry => ({
    id,
    event,
    timeSec,
    time: '0:10',
    temp: '110°C',
    tempC: 110,
    note: id,
});
const point = (time: number, bt: number): LiveRoastPoint => ({
    time,
    bt,
    label: '',
    et: null,
    ror: null,
    ror_et: null,
    heater: null,
    fan: 0,
    drum: 0,
});

describe('roast curve editing', () => {
    let root: Root;
    let api: ReturnType<typeof useRoastCurveEditing> | undefined;
    let savedEntries: LogEntry[];
    let bbp: Parameters<typeof useRoastCurveEditing>[0]['bbp'];
    const applyReviewLog = vi.fn((entries: LogEntry[]) => {
        savedEntries = entries;
    });
    const moveTurningPoint = vi.fn();
    const Probe = () => {
        const state = useRoastingStore();
        const log = useRoastLog('C', state.liveData?.bt ?? null, state.elapsed);
        api = useRoastCurveEditing({
            unit: 'C',
            log,
            review: { applyReviewLog, getReviewLog: () => savedEntries },
            turningPoint: { confirmedTP: null, turningPoints: [], moveTurningPoint },
            bbp,
        });
        return null;
    };
    const render = () => act(() => root.render(createElement(Probe)));
    const editing = () => {
        if (!api) throw new Error('Missing editor');
        return api;
    };
    const openReview = () => {
        const state = useRoastingStore.getState();
        state.reset();
        state.prepareWorkspace('owner');
        const id = state.startCharge(undefined, 'owner');
        if (!id) throw new Error('Missing batch');
        useRoastingStore.setState({ elapsed: 30, livePoints: [point(10, 110), point(20, 120)] });
        state.abortRoast(190, 'C');
        state.saveSucceeded('owner', id);
        savedEntries = [
            entry('record', 'Note', 10),
            entry('charge', 'Charge', 0),
            entry('drop', 'Drop', 20),
            entry('end', 'End', 30),
        ];
        state.setLogState({ entries: [entry('next', 'Note', 1)], unwind: false });
        const snapshot = selectReviewSnapshot(useRoastingStore.getState());
        if (!snapshot) throw new Error('Missing review');
        return snapshot;
    };

    beforeEach(() => {
        api = undefined;
        savedEntries = [];
        bbp = { active: false, nowSec: 150, origin: 100, points: [point(10, 170), point(20, 180)] };
        applyReviewLog.mockClear();
        moveTurningPoint.mockClear();
        useRoastingStore.getState().reset();
        useRoastingStore.setState({
            phase: 'roasting',
            elapsed: 30,
            livePoints: [point(10, 110), point(20, 120)],
            liveData: { bt: 199, et: 210, ror: 0, ror_et: 0, heater: 40, fan: 0, drum: 0 },
            logState: { entries: [entry('live', 'Note', 10)], unwind: false },
        });
        useBbpStore.setState({ active: false, recording: false, events: [], points: [] });
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        useRoastingStore.getState().reset();
        useBbpStore.setState({ active: false, recording: false, events: [], points: [] });
    });

    it.each(['live', 'bbp', 'review'] as const)('edits and deletes only the %s record', async (kind) => {
        const snapshot = kind === 'review' ? openReview() : null;
        const beforeLive = useRoastingStore.getState().logState.entries;
        const id = kind === 'review' ? 'record' : kind;
        if (kind === 'bbp') {
            bbp.active = true;
            useRoastingStore.setState({ phase: 'standby' });
            useBbpStore.setState({ active: true, events: [entry('hidden', 'Note', 90), entry('bbp', 'Note', 110)] });
        }
        await render();
        await act(() => editing().chartHandlers.onEventMarkerEdit?.(id, { timeSec: 20 }));
        if (kind === 'live') {
            expect(useRoastingStore.getState().logState.entries).toEqual([
                expect.objectContaining({ id, timeSec: 20, tempC: 120 }),
            ]);
        } else if (kind === 'bbp') {
            expect(useBbpStore.getState().events).toEqual([
                expect.objectContaining({ id: 'hidden', timeSec: 90 }),
                expect.objectContaining({ id, timeSec: 120, tempC: 180 }),
            ]);
        } else {
            expect(savedEntries).toContainEqual(expect.objectContaining({ id, timeSec: 20, tempC: 120 }));
            expect(useRoastingStore.getState().completed?.snapshot).toBe(snapshot);
        }
        if (kind !== 'live') expect(useRoastingStore.getState().logState.entries).toBe(beforeLive);
        if (kind !== 'review') expect(applyReviewLog).not.toHaveBeenCalled();
        await act(() => editing().removeEntry(id));
        const remaining =
            kind === 'live'
                ? useRoastingStore.getState().logState.entries
                : kind === 'bbp'
                  ? useBbpStore.getState().events
                  : savedEntries;
        expect(remaining.some((row) => row.id === id)).toBe(false);
        if (kind === 'bbp') expect(remaining).toEqual([expect.objectContaining({ id: 'hidden', timeSec: 90 })]);
    });

    it('keeps BBP chart-position and sidebar-now Note temperature rules distinct', async () => {
        bbp.active = true;
        bbp.points = [point(10, 170)];
        useRoastingStore.setState({ phase: 'standby' });
        useBbpStore.setState({ active: true });
        await render();
        await act(() => editing().chartHandlers.onAddNote?.('position', 50));
        await act(() => editing().addNoteNow('now'));
        expect(useBbpStore.getState().events).toEqual([
            expect.objectContaining({ note: 'position', timeSec: 150, tempC: null }),
            expect.objectContaining({ note: 'now', timeSec: 150, tempC: 170 }),
        ]);
        bbp.points = [];
        await render();
        await act(() => editing().addNoteNow('fallback'));
        expect(useBbpStore.getState().events[2]).toMatchObject({ note: 'fallback', tempC: 199 });
    });

    it('preserves TP placement and routes dragging through the same edit operation', async () => {
        await render();
        await act(() => editing().chartHandlers.onEventMarkerDrag?.('live', 20));
        expect(useRoastingStore.getState().logState.entries[0]).toMatchObject({ timeSec: 20, tempC: 120 });
        await act(() => editing().chartHandlers.onEventMarkerEdit?.(TP_MARKER_ID, { timeSec: 10 }));
        expect(moveTurningPoint).toHaveBeenCalledWith(10, 110);
        await act(() => useRoastingStore.setState({ livePoints: [] }));
        await act(() => editing().chartHandlers.onEventMarkerEdit?.(TP_MARKER_ID, { timeSec: 10 }));
        expect(moveTurningPoint).toHaveBeenCalledTimes(1);
    });

    it('protects saved lifecycle marks and preserves entered temperatures on new marks', async () => {
        const snapshot = openReview();
        const beforeLive = useRoastingStore.getState().logState.entries;
        bbp.active = true;
        await render();
        await act(() => {
            editing().chartHandlers.onEventMarkerEdit?.('drop', { timeSec: 15 });
            editing().removeEntry('charge');
        });
        expect(applyReviewLog).not.toHaveBeenCalled();
        await act(() => editing().addEvent('Yellow', 12, 151));
        expect(savedEntries).toContainEqual(expect.objectContaining({ event: 'Yellow', timeSec: 12, tempC: 151 }));
        expect(useRoastingStore.getState().logState.entries).toBe(beforeLive);
        expect(useRoastingStore.getState().completed?.snapshot).toBe(snapshot);
        expect(editing().logEditOptions).toMatchObject({ maxTimeSec: 30, livePoints: snapshot.livePoints });
        expect(editing().chartHandlers.onMoveEvent).toBeDefined();
    });

    it('selects the current owner when an old callback runs after leaving review', async () => {
        openReview();
        await render();
        const edit = editing().chartHandlers.onEventMarkerEdit;
        await act(() => {
            useRoastingStore.getState().dismissCompletedReview();
            edit?.('next', { note: 'live edit' });
        });
        expect(applyReviewLog).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().logState.entries).toContainEqual(
            expect.objectContaining({ id: 'next', note: 'live edit' }),
        );
    });

    it('disables idle/ended chart editing and enables BBP notes without roast marks', async () => {
        for (const phase of ['idle', 'ended'] as const) {
            useRoastingStore.setState({ phase });
            await render();
            expect(Object.values(editing().chartHandlers).every((handler) => handler === undefined)).toBe(true);
            expect(editing().logEditOptions).toBeUndefined();
        }
        bbp.active = true;
        useRoastingStore.setState({ phase: 'standby' });
        await render();
        expect(editing().chartHandlers.onAddNote).toBeDefined();
        expect(editing().chartHandlers.onAddEvent).toBeUndefined();
        expect(editing().chartHandlers.onMoveEvent).toBeUndefined();
        expect(editing().logEditOptions).toMatchObject({ livePoints: bbp.points, maxTimeSec: 50 });
    });
});
