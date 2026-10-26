// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { deleteBbpTsv } from '@shared/lib/tsv-writer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyExplicitDisconnectReset } from './explicit-disconnect-reset';

vi.mock('@shared/lib/tsv-writer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/tsv-writer')>();
    return { ...actual, deleteBbpTsv: vi.fn(async () => undefined) };
});

beforeEach(() => {
    useRoastingStore.getState().reset();
    useRoastingStore.getState().setConnected(false);
    useBbpStore.getState().abort();
    useBbpStore.setState({ finalized: null, finalizedPoints: [] });
    vi.mocked(deleteBbpTsv).mockClear();
});

afterEach(() => {
    useRoastingStore.getState().reset();
    useBbpStore.getState().abort();
});

describe('applyExplicitDisconnectReset', () => {
    it('abandons an in-progress roast curve', () => {
        useRoastingStore.getState().setConnected(true);
        useRoastingStore.getState().startCharge();
        useRoastingStore.getState().setPendingProfile('profile-1');
        useBbpStore.getState().begin(Date.now(), [{ t: 1, bt: 190, et: 200, heater: 1, fan: 1, drum: 1 }], false);
        const setLivePoints = vi.fn();
        const setLogEntries = vi.fn();

        applyExplicitDisconnectReset(setLivePoints, setLogEntries);

        const state = useRoastingStore.getState();
        expect(state.phase).toBe('idle');
        expect(state.sidecarConnected).toBe(false);
        expect(state.sessionId).toBeNull();
        expect(state.pendingProfileId).toBeNull();
        expect(setLivePoints).toHaveBeenCalledWith([]);
        expect(setLogEntries).toHaveBeenCalledWith([]);
        expect(useBbpStore.getState().points).toEqual([]);
        expect(useBbpStore.getState().active).toBe(false);
        expect(deleteBbpTsv).toHaveBeenCalledOnce();
    });

    it('returns Charge-wait to an empty idle screen and keeps an unsaved Drop', () => {
        useRoastingStore.setState({
            phase: 'standby',
            sidecarConnected: true,
            awaitingNextCharge: true,
            pendingProfileId: 'profile-1',
            heatHoldAfterDrop: true,
            completed: {
                summary: { totalTime: '8:00', development: '20%', finalBt: '200', logEntries: [] },
                snapshot: {
                    sessionId: 'dropped-batch',
                    curveRecorded: true,
                    sessionOwnerId: 'owner',
                    roastStartMs: 1,
                    elapsed: 480,
                    rawBT: 200,
                    selection: { beanId: null, beanName: null, profileId: null, planBatchHandoff: null },
                    logEntries: [],
                    livePoints: [],
                    machineSnapshot: null,
                },
                restore: null,
                submitted: false,
            },
        });
        useBbpStore.setState({
            active: true,
            recording: true,
            points: [{ t: 4, bt: 210, et: 220, heater: 1, fan: 1, drum: 1 }],
            finalized: { sessionId: 'dropped-batch', seconds: 90, chargeTemp: 200 },
            finalizedPoints: [{ t: 90, bt: 200, et: 210, heater: 1, fan: 1, drum: 1 }],
        });
        const setLivePoints = vi.fn();
        const setLogEntries = vi.fn();

        applyExplicitDisconnectReset(setLivePoints, setLogEntries);

        const state = useRoastingStore.getState();
        expect(state.phase).toBe('idle');
        expect(state.awaitingNextCharge).toBe(false);
        expect(state.heatHoldAfterDrop).toBe(false);
        expect(state.pendingProfileId).toBeNull();
        expect(state.sidecarConnected).toBe(false);
        expect(state.completed?.snapshot.sessionId).toBe('dropped-batch');
        expect(state.completed?.submitted).toBe(false);
        expect(setLivePoints).toHaveBeenCalledWith([]);
        expect(setLogEntries).toHaveBeenCalledWith([]);
        expect(useBbpStore.getState().active).toBe(false);
        expect(useBbpStore.getState().points).toEqual([]);
        expect(useBbpStore.getState().finalized?.sessionId).toBe('dropped-batch');
    });

    it('clears first-batch preheat instead of leaving a chart', () => {
        useRoastingStore.setState({ phase: 'preheating', sidecarConnected: true });
        useBbpStore.getState().begin(Date.now(), [{ t: 1, bt: 180, et: 190, heater: 0, fan: 0, drum: 0 }], false);

        applyExplicitDisconnectReset(vi.fn(), vi.fn());

        expect(useRoastingStore.getState().phase).toBe('idle');
        expect(useRoastingStore.getState().sidecarConnected).toBe(false);
        expect(useBbpStore.getState().active).toBe(false);
    });
});
