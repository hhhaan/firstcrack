// @vitest-environment jsdom
import { logger } from '@shared/lib/logger';
import { settingsSet } from '@shared/lib/settings-store';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { getBatchNumber, useBatchNumber } from './useBatchNumber';

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

it('looks up the completed session number after the next Charge without reserving again', async () => {
    chargeProfile();
    const sessionId = useRoastingStore.getState().sessionId;
    if (!sessionId) throw new Error('Charge did not start');
    expect(await getBatchNumber('owner', sessionId)).toBe(1);
    chargeProfile();
    expect(await getBatchNumber('owner', sessionId)).toBe(1);
    expect(await getBatchNumber('other-owner', sessionId)).toBeNull();
    expect(storage.value).toMatchObject({ counters: { [JSON.stringify(['owner', 'p'])]: 2 } });
});

it.each(['local', 'settings'])('reads a recovered session number from %s storage', async (target) => {
    const ledger = {
        counters: { scope: 3 },
        sessions: { [JSON.stringify(['owner', 'recovered'])]: { scope: 'scope', number: 3 } },
    };
    if (target === 'local') localStorage.setItem('roast.batchNumbers', JSON.stringify(ledger));
    else storage.value = ledger;
    expect(await getBatchNumber('owner', 'recovered')).toBe(3);
    expect(await getBatchNumber('owner', 'missing')).toBeNull();
});

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
it('counts the Charge profile while the header is absent and preserves that number after a reference edit', async () => {
    localStorage.clear();
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
        await act(async () => {
            charge('a');
            const state = useRoastingStore.getState();
            if (state.activeSelection)
                useRoastingStore.setState({ activeSelection: { ...state.activeSelection, profileId: 'b' } });
        });
        await act(async () => root.render(createElement(Probe)));
        expect(number).toBe(1);
        await act(async () => charge('b'));
        expect(number).toBe(1);
        await act(async () => charge('a'));
        expect(number).toBe(2);
        await act(async () => root.render(null));
        await act(async () => root.render(createElement(Probe)));
        expect(number).toBe(2);
    } finally {
        await act(async () => root.unmount());
        useRoastingStore.setState(initial, true);
        localStorage.clear();
    }
});
