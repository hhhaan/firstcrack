// @vitest-environment jsdom
import { logger } from '@shared/lib/logger';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useBatchNumber } from './useBatchNumber';

const storage = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn(async () => storage.value),
    settingsSet: vi.fn(async (_key: string, value: unknown) => {
        storage.value = value;
    }),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
    storage.value = undefined;
    localStorage.clear();
    vi.mocked(logger.capture).mockClear();
    vi.mocked(settingsGet).mockImplementation(async () => storage.value);
    vi.mocked(settingsSet).mockImplementation(async (_key, value) => {
        storage.value = value;
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    useRoastingStore.setState(useRoastingStore.getInitialState(), true);
    localStorage.clear();
});

const chargeProfile = () => {
    const initial = useRoastingStore.getInitialState();
    useRoastingStore.setState({
        ...initial,
        prepared: { ...initial.prepared, profileId: 'p', workspaceOwnerId: 'owner' },
    });
    useRoastingStore.getState().startCharge(undefined, 'owner');
};

it.each(['local', 'settings'])('continues numbering after a partial %s write failure', async (target) => {
    await act(async () => chargeProfile());
    if (target === 'local')
        vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('local write failed');
        });
    else vi.mocked(settingsSet).mockRejectedValueOnce(new Error('settings write failed'));
    await act(async () => chargeProfile());
    await act(async () => chargeProfile());
    const expected = { counters: { [JSON.stringify(['owner', 'p'])]: 3 } };
    expect(storage.value).toMatchObject(expected);
    expect(JSON.parse(localStorage.getItem('roast.batchNumbers') ?? 'null')).toMatchObject(expected);
});

it('does not report an already captured persistence failure twice', async () => {
    const error = new Error('settings write failed');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('local write failed');
    });
    vi.mocked(settingsSet).mockImplementationOnce(async () => {
        logger.capture(error, { scope: 'settings-store.set' });
        throw error;
    });
    await act(async () => chargeProfile());
    expect(logger.capture).toHaveBeenCalledExactlyOnceWith(error, { scope: 'settings-store.set' });
});
it('follows the selected profile while preserving overall identity through remounts and A → B → A', async () => {
    storage.value = {
        counters: {
            [JSON.stringify(['owner', 'a'])]: 4,
            [JSON.stringify(['owner', 'b'])]: 8,
            [JSON.stringify(['owner', null, 'total'])]: 12,
        },
        sessions: {},
    };
    const initial = useRoastingStore.getInitialState();
    const root = createRoot(document.createElement('div'));
    let number: number | null = null;
    const Probe = () => {
        number = useBatchNumber();
        return null;
    };
    const charge = (profileId: string) => {
        const state = useRoastingStore.getState();
        useRoastingStore.setState({
            ...initial,
            prepared: { ...state.prepared, profileId, workspaceOwnerId: 'owner' },
        });
        useRoastingStore.getState().startCharge(undefined, 'owner');
    };
    try {
        await act(async () => charge('a'));
        await act(async () => root.render(createElement(Probe)));
        expect(number).toBe(5);
        const id = useRoastingStore.getState().sessionId;
        await act(async () => {
            useRoastingStore.getState().commitProfile('b', id, 'owner');
        });
        expect(number).toBe(9);
        expect(useRoastingStore.getState().activeSelection?.identity).toMatchObject({
            profileId: 'b',
            number: 9,
            totalNumber: 13,
        });
        await act(async () => {
            useRoastingStore.getState().commitProfile('a', id, 'owner');
        });
        expect(number).toBe(5);
        expect(useRoastingStore.getState().activeSelection?.identity?.totalNumber).toBe(13);
        await act(async () => root.render(null));
        await act(async () => root.render(createElement(Probe)));
        expect(number).toBe(5);
        await act(async () => charge('b'));
        expect(number).toBe(10);
        expect(useRoastingStore.getState().activeSelection?.identity?.totalNumber).toBe(14);
        await act(async () => charge('a'));
        expect(number).toBe(6);
    } finally {
        await act(async () => root.unmount());
        useRoastingStore.setState(initial, true);
        localStorage.clear();
    }
});

it('updates profile numbers while keeping a manually edited title', async () => {
    await act(async () => chargeProfile());
    const state = useRoastingStore.getState();
    const id = state.sessionId ?? '';
    state.setRunningBatchTitle(id, 'Morning production');
    await act(async () => {
        useRoastingStore.getState().commitProfile('other', id, 'owner');
    });
    expect(useRoastingStore.getState().activeSelection?.identity).toMatchObject({
        profileId: 'other',
        number: 1,
        totalNumber: 1,
        title: 'Morning production',
        edited: true,
    });
});

it('applies delayed reservations only to the matching profile and completed session', async () => {
    let release: (() => void) | undefined;
    vi.mocked(settingsGet).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                release = () => resolve(storage.value);
            }),
    );
    await act(async () => chargeProfile());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const state = useRoastingStore.getState();
    const id = state.sessionId;
    act(() => {
        state.commitProfile('other', id, 'owner');
        state.abortRoast(200, 'C');
        state.startCharge(undefined, 'owner');
        release?.();
    });
    await vi.waitFor(() => {
        const current = useRoastingStore.getState();
        expect(current.activeSelection?.identity?.number).toBe(2);
        expect(current.activeSelection?.identity?.totalNumber).toBe(2);
    });
    const completed = useRoastingStore.getState().completed;
    expect(completed?.snapshot.selection.identity).toMatchObject({ profileId: 'other', number: 1, totalNumber: 1 });
    expect(completed?.summary?.batchName).toBe('Roast #1');
});
