// @vitest-environment jsdom
import { EMPTY_MACHINE_SNAPSHOT, type Machine, useMachines, VIRTUAL_ID } from '@entities/machine';
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManualControlSection } from './ManualControlSection';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const flags = vi.hoisted(() => ({ simulator: true }));
vi.mock('@shared/lib/features', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/lib/features')>()),
    useFeature: () => flags.simulator,
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

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
const originalSnapshot = useRoastingStore.getState().machineSnapshot;
const originalSettings = getRoastSettings();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    flags.simulator = true;
    useMachines.setState({ machines: [machine(VIRTUAL_ID), machine('first'), machine('current')] });
    useRoastingStore.setState({ machineSnapshot: { ...EMPTY_MACHINE_SNAPSHOT, machine_id: 'current' } });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useMachines.setState({ machines: originalMachines });
    useRoastingStore.setState({ machineSnapshot: originalSnapshot });
    updateRoastSettings(originalSettings);
});

const picker = () => {
    const select = host.querySelector('select');
    if (!select) throw new Error('Missing machine picker');
    return select;
};

it.each(['current', VIRTUAL_ID])('opens on the current machine %s and lists it first', (id) => {
    useRoastingStore.setState({ machineSnapshot: { ...EMPTY_MACHINE_SNAPSHOT, machine_id: id } });
    act(() => root.render(createElement('form', null, createElement(ManualControlSection))));
    expect(picker().value).toBe(id);
    expect(picker().options[0].value).toBe(id);
});

it('keeps an explicit selection and saves controls only for that machine', () => {
    act(() => root.render(createElement('form', null, createElement(ManualControlSection))));
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

it.each(['missing', VIRTUAL_ID])('falls back to a real machine when current machine %s is unavailable', (id) => {
    flags.simulator = false;
    useRoastingStore.setState({ machineSnapshot: { ...EMPTY_MACHINE_SNAPSHOT, machine_id: id } });
    act(() => root.render(createElement('form', null, createElement(ManualControlSection))));
    expect(picker().value).toBe('first');
    expect([...picker().options].map((option) => option.value)).toEqual(['first', 'current']);
});
