// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useBatchNumber } from './useBatchNumber';

const storage = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn(async () => storage.value),
    settingsSet: vi.fn(async (_key: string, value: unknown) => {
        storage.value = value;
    }),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
