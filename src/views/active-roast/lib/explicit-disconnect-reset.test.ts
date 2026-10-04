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

    it('clears a standby trace and keeps the unsaved next-batch wait', () => {
        useRoastingStore.setState({
            phase: 'standby',
            sidecarConnected: true,
            awaitingNextCharge: true,
            pendingProfileId: 'profile-1',
        });
        useBbpStore.setState({
            active: true,
            recording: false,
            points: [{ t: 4, bt: 210, et: 220, heater: 1, fan: 1, drum: 1 }],
            finalized: { sessionId: 'saved-batch', seconds: 90, chargeTemp: 200 },
            finalizedPoints: [{ t: 90, bt: 200, et: 210, heater: 1, fan: 1, drum: 1 }],
        });
        const setLivePoints = vi.fn();
        const setLogEntries = vi.fn();

        applyExplicitDisconnectReset(setLivePoints, setLogEntries);

        const state = useRoastingStore.getState();
        expect(state.phase).toBe('standby');
        expect(state.awaitingNextCharge).toBe(true);
        expect(state.pendingProfileId).toBe('profile-1');
        expect(state.sidecarConnected).toBe(true);
        expect(setLivePoints).toHaveBeenCalledWith([]);
        expect(setLogEntries).toHaveBeenCalledWith([]);
        expect(useBbpStore.getState().active).toBe(false);
        expect(useBbpStore.getState().points).toEqual([]);
        expect(useBbpStore.getState().finalized?.sessionId).toBe('saved-batch');
    });
});
