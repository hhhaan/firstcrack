// @vitest-environment jsdom

import type { NetworkHost } from '@entities/machine';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddMachineForm } from './useAddMachineForm';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const io = vi.hoisted(() => ({ scan: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), temperatures: vi.fn() }));
vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getSerialPorts: async () => [],
        scanNetwork: io.scan,
        connect: io.connect,
        disconnect: io.disconnect,
        getTemperatures: io.temperatures,
    },
}));
vi.mock('@shared/lib/features', () => ({
    FEATURE: { customMachineControl: 'customMachineControl' },
    useFeature: () => true,
}));
vi.mock('@shared/lib/features/useAccountPlan', () => ({ useAccountPlan: () => 'enterprise' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('machine form status', () => {
    let root: Root;
    let form: ReturnType<typeof useAddMachineForm>;
    const onClose = vi.fn();
    const onAdd = vi.fn();
    function Harness() {
        form = useAddMachineForm({ open: true, onClose, onAdd });
        return null;
    }

    beforeEach(async () => {
        vi.resetAllMocks();
        io.disconnect.mockResolvedValue({ connected: false });
        io.temperatures.mockResolvedValue({ bt: 180 });
        root = createRoot(document.createElement('div'));
        await act(async () => root.render(createElement(Harness)));
    });
    afterEach(() => act(() => root.unmount()));

    it('distinguishes no scan from an empty result and retains results while rescanning', async () => {
        expect(form.scannedNetworkOnce).toBe(false);
        expect(form.networkHosts).toEqual([]);
        let resolve!: (hosts: NetworkHost[]) => void;
        io.scan.mockReturnValue(
            new Promise<NetworkHost[]>((yes) => {
                resolve = yes;
            }),
        );
        act(() => form.scanNetworkHosts('s7'));
        expect(form.scanningNetwork).toBe(true);
        expect(form.scannedNetworkOnce).toBe(false);
        const hosts = [{ host: '192.0.2.10' }];
        await act(async () => resolve(hosts));
        expect(form.networkHosts).toEqual(hosts);
        expect(form.scannedNetworkOnce).toBe(true);
        expect(form.scanningNetwork).toBe(false);

        io.scan.mockReturnValue(
            new Promise<NetworkHost[]>((yes) => {
                resolve = yes;
            }),
        );
        act(() => form.scanNetworkHosts('s7'));
        expect(form.networkHosts).toEqual(hosts);
        expect(form.scanningNetwork).toBe(true);
        expect(form.scannedNetworkOnce).toBe(true);
        await act(async () => resolve([]));
        expect(form.networkHosts).toEqual([]);
        expect(form.scannedNetworkOnce).toBe(true);
        expect(form.scanningNetwork).toBe(false);

        io.scan.mockRejectedValue(new Error('Scan failed'));
        await act(async () => form.scanNetworkHosts('s7'));
        expect(form.networkHosts).toEqual([]);
        expect(form.scannedNetworkOnce).toBe(true);
        expect(form.scanningNetwork).toBe(false);
    });

    it('keeps connection feedback atomic and clears it when parameters change', async () => {
        act(() => form.selectRoaster('virtual'));
        let resolve!: (status: { connected: boolean; error?: string }) => void;
        io.connect.mockReturnValue(
            new Promise((yes) => {
                resolve = yes;
            }),
        );
        let pending!: Promise<void>;
        await act(async () => {
            pending = form.handleTestConnection();
        });
        expect(form.connectionTest).toEqual({ status: 'testing' });
        await act(async () => {
            resolve({ connected: true });
            await pending;
        });
        expect(form.connectionTest).toEqual({ status: 'success', message: 'addMachine.connectedWithBt' });

        act(() => form.setParam('host', '192.0.2.11'));
        expect(form.connectionTest).toEqual({ status: 'idle' });
        io.connect.mockResolvedValue({ connected: false, error: 'Denied' });
        await act(async () => form.handleTestConnection());
        expect(form.connectionTest).toEqual({ status: 'failed', message: 'Denied' });

        act(() => form.selectRoaster('virtual'));
        expect(form.connectionTest).toEqual({ status: 'idle' });
        io.connect.mockRejectedValue(new Error('Offline'));
        await act(async () => form.handleTestConnection());
        expect(form.connectionTest).toEqual({ status: 'failed', message: 'Offline' });
        expect(io.disconnect).toHaveBeenCalled();
    });
});
