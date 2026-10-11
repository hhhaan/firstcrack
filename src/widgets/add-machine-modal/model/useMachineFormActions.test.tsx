// @vitest-environment jsdom

import { sidecar } from '@shared/lib/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useMachineFormActions } from './useMachineFormActions';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        connect: vi.fn(),
        disconnect: vi.fn(),
        getTemperatures: vi.fn().mockResolvedValue({ bt: 180 }),
        updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    },
}));
vi.mock('@shared/lib/features/useAccountPlan', () => ({ useAccountPlan: () => 'enterprise' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('uses the tested identity when adding and reserves a fresh ID for the next add', async () => {
    const root = createRoot(document.createElement('div'));
    const onAdd = vi.fn();
    const testConnectedRef = { current: false };
    let form!: ReturnType<typeof useMachineFormActions>;
    const Probe = () => {
        form = useMachineFormActions({
            isEdit: false,
            isCustom: false,
            selectedDef: {
                display_name: 'W60',
                brand: 'Giesen',
                models: [],
                protocol: 's7',
                capabilities: [],
                pid: null,
                form_fields: [],
                default_params: {},
            },
            connectKey: 'giesen_w45a_w60a',
            customName: '',
            customBrand: '',
            params: {},
            showAddressMap: false,
            includeWriteMap: false,
            editing: null,
            onAdd,
            onClose: vi.fn(),
            testConnectedRef,
            setSaving: vi.fn(),
            setError: vi.fn(),
            setTestState: vi.fn(),
            setTestMessage: vi.fn(),
        });
        return null;
    };
    vi.mocked(sidecar.connect).mockImplementation(async (_key, _params, id) => ({
        connected: true,
        machine_id: id,
        connection_epoch: 1,
        roaster: 'giesen_w45a_w60a',
        display_name: 'W60',
        brand: 'Giesen',
        capabilities: [],
        uptime: 0,
        error: null,
    }));
    await act(async () => {
        root.render(createElement(Probe));
    });
    try {
        await act(async () => {
            await form.handleTestConnection();
        });
        const firstId = vi.mocked(sidecar.connect).mock.calls[0][2];
        await act(async () => {
            await form.commit('addAndConnect');
        });
        expect(onAdd.mock.calls[0][3].id).toBe(firstId);
        await act(async () => {
            await form.handleTestConnection();
        });
        expect(vi.mocked(sidecar.connect).mock.calls[1][2]).not.toBe(firstId);
        await act(async () => {
            await form.commit('addAndConnect');
        });
        expect(onAdd.mock.calls[1][3].id).toBe(vi.mocked(sidecar.connect).mock.calls[1][2]);
    } finally {
        await act(async () => {
            root.unmount();
        });
    }
});
