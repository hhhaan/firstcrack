// @vitest-environment jsdom
import { initRoasterFormParams, ROASTER_REGISTRY, type TemperatureReading } from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMachineFormActions } from './useMachineFormActions';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: { connect: vi.fn(), disconnect: vi.fn(), getTemperatures: vi.fn() },
}));
vi.mock('@shared/lib/features/useAccountPlan', () => ({ useAccountPlan: () => 'enterprise' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const healthy: TemperatureReading = {
    bt: 20,
    et: 25,
    et_raw: 25,
    ror: 0,
    ror_et: 0,
    heater: null,
    fan: 0,
    drum: 0,
    timestamp: 1,
};

describe('Phidget connection test', () => {
    let root: Root;
    let form: ReturnType<typeof useMachineFormActions>;
    let params: Record<string, string>;
    const testConnectedRef = { current: false };
    const setConnectionTest = vi.fn();
    function Harness() {
        form = useMachineFormActions({
            isEdit: false,
            isCustom: false,
            selectedDef: ROASTER_REGISTRY.phidget_tmp1101,
            connectKey: 'phidget_tmp1101',
            customName: '',
            customBrand: '',
            params,
            showAddressMap: false,
            includeWriteMap: false,
            editing: null,
            onAdd: vi.fn(),
            onClose: vi.fn(),
            testConnectedRef,
            setSaving: vi.fn(),
            setError: vi.fn(),
            setConnectionTest,
        });
        return null;
    }
    beforeEach(async () => {
        vi.resetAllMocks();
        params = initRoasterFormParams(ROASTER_REGISTRY.phidget_tmp1101);
        testConnectedRef.current = false;
        vi.mocked(sidecar.connect).mockResolvedValue({
            connected: true,
            machine_id: 'test',
            connection_epoch: 1,
            roaster: 'phidget_tmp1101',
            display_name: 'Phidget',
            brand: 'Phidget',
            capabilities: [],
            uptime: 0,
            error: null,
        });
        vi.mocked(sidecar.disconnect).mockResolvedValue({
            connected: false,
            roaster: '',
            machine_id: null,
            connection_epoch: 1,
            display_name: '',
            brand: '',
            capabilities: [],
            uptime: 0,
            error: null,
        });
        vi.mocked(sidecar.getTemperatures).mockResolvedValue(healthy);
        root = createRoot(document.createElement('div'));
        await act(async () => root.render(createElement(Harness)));
    });
    afterEach(async () => act(async () => root.unmount()));

    it.each([
        { bt: null },
        { bt: -1 },
        { bt: 0 },
        { bt: 400 },
        { bt: Number.NaN },
        { bt: Number.POSITIVE_INFINITY },
        { stale: true },
        { reconnecting: true },
        { et: null },
        { et: -1 },
        { et: Number.NaN },
        { et_raw: -1 },
        { et_raw: null },
    ])('rejects invalid first readings and releases the connection: %j', async (readings) => {
        vi.mocked(sidecar.getTemperatures).mockResolvedValue({ ...healthy, ...readings });
        await act(async () => form.handleTestConnection());
        expect(setConnectionTest).toHaveBeenLastCalledWith({
            status: 'failed',
            message: 'addMachine.phidgetReadingFailed',
        });
        expect(sidecar.disconnect).toHaveBeenCalledOnce();
        expect(testConnectedRef.current).toBe(false);
    });

    it('rejects a failed first read and awaits disconnect', async () => {
        vi.mocked(sidecar.getTemperatures).mockRejectedValue(new Error('Read failed'));
        await act(async () => form.handleTestConnection());
        expect(setConnectionTest).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(sidecar.disconnect).toHaveBeenCalledOnce();
        expect(testConnectedRef.current).toBe(false);
    });

    it('accepts finite BT with disabled ET and preserves the test link', async () => {
        params.channel_et = '';
        vi.mocked(sidecar.getTemperatures).mockResolvedValue({ ...healthy, bt: 20, et: null, et_raw: -1 });
        await act(async () => form.handleTestConnection());
        expect(setConnectionTest).toHaveBeenLastCalledWith({
            status: 'success',
            message: 'addMachine.connectedWithBt',
        });
        expect(sidecar.disconnect).not.toHaveBeenCalled();
        expect(testConnectedRef.current).toBe(true);
    });

    it('retains cleanup ownership if disconnect fails', async () => {
        vi.mocked(sidecar.getTemperatures).mockResolvedValue({ ...healthy, bt: null });
        vi.mocked(sidecar.disconnect).mockRejectedValue(new Error('Disconnect failed'));
        await act(async () => form.handleTestConnection());
        expect(setConnectionTest).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(testConnectedRef.current).toBe(true);
    });
});
