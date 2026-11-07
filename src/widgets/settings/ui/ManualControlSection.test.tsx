// @vitest-environment jsdom
import { EMPTY_MACHINE_SNAPSHOT, type Machine, useMachines, VIRTUAL_ID } from '@entities/machine';
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { sidecar } from '@shared/lib/sidecar';
import type { SidecarStatus } from '@shared/types/sidecar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManualControlSection } from './ManualControlSection';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@shared/lib/sidecar', () => ({ sidecar: { getStatus: vi.fn() } }));
const flags = vi.hoisted(() => ({ simulator: true }));
vi.mock('@shared/lib/features', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/lib/features')>()),
    useFeature: () => flags.simulator,
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
HTMLElement.prototype.scrollIntoView = vi.fn();

const machine = (id: string): Machine => ({
    id,
    name: id,
    roasterKey: 'giesen_w45a_w60a',
    displayName: id,
    brand: 'Giesen',
    models: [],
    protocol: 'modbus',
    connectionParams: {},
    capabilities: [],
    pid: null,
    createdAt: '2026-01-01T00:00:00Z',
});
const originalMachines = useMachines.getState().machines;
const simulator = originalMachines.find((item) => item.id === VIRTUAL_ID);
if (!simulator) throw new Error('Missing seeded virtual machine');
const originalSnapshot = useRoastingStore.getState().machineSnapshot;
const originalSettings = getRoastSettings();
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const statusFor = (item: Machine): SidecarStatus => ({
    connected: true,
    machine_id: item.id,
    roaster: item.roasterKey,
    display_name: item.displayName,
    brand: item.brand,
    capabilities: item.capabilities,
    uptime: 1,
    error: null,
});

beforeEach(() => {
    flags.simulator = true;
    useMachines.setState({ machines: [simulator, machine('first'), machine('current')] });
    useRoastingStore.setState({ machineSnapshot: { ...EMPTY_MACHINE_SNAPSHOT, machine_id: 'current' } });
    vi.mocked(sidecar.getStatus).mockResolvedValue(statusFor(machine('current')));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    client.clear();
    useMachines.setState({ machines: originalMachines });
    useRoastingStore.setState({ machineSnapshot: originalSnapshot });
    updateRoastSettings(originalSettings);
});

const picker = () => {
    const select = host.querySelector('select');
    if (!select) throw new Error('Missing machine picker');
    return select;
};

const renderSection = async () => {
    await act(async () =>
        root.render(
            createElement(
                QueryClientProvider,
                { client },
                createElement('form', null, createElement(ManualControlSection)),
            ),
        ),
    );
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
};

it.each(['current', VIRTUAL_ID])('opens on the current machine %s and lists it first', async (id) => {
    vi.mocked(sidecar.getStatus).mockResolvedValue(statusFor(id === VIRTUAL_ID ? simulator : machine(id)));
    useRoastingStore.setState({ machineSnapshot: { ...EMPTY_MACHINE_SNAPSHOT, machine_id: id } });
    await renderSection();
    expect(picker().value).toBe(id);
    expect(picker().options[0].value).toBe(id);
});

it('keeps an explicit selection and saves controls only for that machine', async () => {
    await renderSection();
    act(() => {
        picker().value = 'first';
        picker().dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => useRoastingStore.setState({ machineSnapshot: { ...EMPTY_MACHINE_SNAPSHOT, machine_id: VIRTUAL_ID } }));
    expect(picker().value).toBe('first');
    const gas = host.querySelector<HTMLInputElement>('input[aria-label="activeRoast.noteEntry.gas"]');
    if (!gas) throw new Error('Missing gas toggle');
    act(() => gas.click());
    expect(getRoastSettings().manualControlsByMachine.first?.find((row) => row.id === 'gas')?.enabled).toBe(false);
    expect(getRoastSettings().manualControlsByMachine.current).toBeUndefined();
});

it.each([null, 'current'])('uses connected virtual machine before opening Roast, with snapshot %s', async (id) => {
    flags.simulator = false;
    useRoastingStore.setState({
        machineSnapshot: id ? { ...EMPTY_MACHINE_SNAPSHOT, machine_id: id } : null,
    });
    vi.mocked(sidecar.getStatus).mockResolvedValue(statusFor(simulator));
    await renderSection();
    expect(picker().value).toBe(VIRTUAL_ID);
    act(() =>
        host
            .querySelector('[role="combobox"]')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
        simulator.name,
        'first',
        'current',
    ]);
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const gas = host.querySelector<HTMLInputElement>('input[aria-label="activeRoast.noteEntry.gas"]');
    if (!gas) throw new Error('Missing gas toggle');
    act(() => gas.click());
    expect(getRoastSettings().manualControlsByMachine[VIRTUAL_ID]?.find((row) => row.id === 'gas')?.enabled).toBe(
        false,
    );
    expect(getRoastSettings().manualControlsByMachine.current).toBeUndefined();
});

it('does not match another registered machine by model when connection identity is missing', async () => {
    flags.simulator = false;
    useRoastingStore.setState({ machineSnapshot: null });
    vi.mocked(sidecar.getStatus).mockResolvedValue({ ...statusFor(machine('current')), machine_id: null });
    await renderSection();
    expect(picker().value).toBe('first');
    expect([...picker().options].map((option) => option.value)).toEqual(['first', 'current']);
});
