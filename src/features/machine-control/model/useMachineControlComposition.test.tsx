// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    subscribeSidecarSettings: vi.fn(() => () => {}),
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
        setDischarge: vi.fn(),
        setFill: vi.fn(),
        pidOn: vi.fn(),
        pidOff: vi.fn(),
        pidSetSv: vi.fn(),
    },
}));
vi.mock('@shared/lib/logger', () => ({
    logger: { capture: vi.fn() },
}));
vi.mock('@shared/store/toast', () => ({
    useToastStore: { getState: () => ({ show: vi.fn() }) },
}));

import { useMachines } from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import { type MachineControlCompositionInput, useMachineControlComposition } from './useMachineControlComposition';
import {
    applyControl,
    baseMachineControlInput as base,
    offPidResponse,
    pidRuntime as runtime,
    writableHeaterStatus,
} from './useMachineControlComposition.fixtures';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);
const setControl = vi.mocked(sidecar.setControl);
const pidOff = vi.mocked(sidecar.pidOff);

const renderComposition = async (initial: MachineControlCompositionInput) => {
    const root = createRoot(document.createElement('div'));
    let latest!: ReturnType<typeof useMachineControlComposition>;
    const Probe = ({ input }: { input: MachineControlCompositionInput }) => {
        latest = useMachineControlComposition(input);
        return null;
    };
    const rerender = (input: MachineControlCompositionInput) =>
        act(async () => {
            root.render(createElement(Probe, { input }));
        });
    await rerender(initial);
    return { get: () => latest, rerender, unmount: () => act(() => root.unmount()) };
};

describe('useMachineControlComposition', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getStatus.mockReset();
        setControl.mockReset();
        pidOff.mockReset();
        getStatus.mockResolvedValue(writableHeaterStatus);
        setControl.mockImplementation(applyControl);
        pidOff.mockResolvedValue(offPidResponse);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('runs Drop hold and zero while the panel is not mounted', async () => {
        const hold = await renderComposition({ ...base(), pidRuntime: runtime('running'), pidDropBehavior: 'hold' });
        await hold.rerender({
            ...base(),
            pidRuntime: runtime('running'),
            pidDropBehavior: 'hold',
            roastFinished: true,
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledWith('hold');
        await hold.unmount();

        pidOff.mockClear();
        const zero = await renderComposition({ ...base(), pidRuntime: runtime('running'), pidDropBehavior: 'zero' });
        await zero.rerender({
            ...base(),
            pidRuntime: runtime('running'),
            pidDropBehavior: 'zero',
            roastFinished: true,
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(pidOff).toHaveBeenCalledWith('zero');
        await zero.unmount();
    });

    it('rejects the other door while one command is in flight and does not run it later', async () => {
        let release: (value: { ok: true }) => void = () => {};
        const pending = new Promise<{ ok: true }>((resolve) => {
            release = resolve;
        });
        vi.mocked(sidecar.setDischarge).mockReturnValue(pending);
        vi.mocked(sidecar.setFill).mockResolvedValue({ ok: true });
        useMachines.setState({
            machines: [
                {
                    id: 'door-b',
                    name: 'B',
                    roasterKey: 'giesen_w45a_w60a',
                    displayName: 'B',
                    brand: 'Giesen',
                    models: [],
                    protocol: 's7',
                    connectionParams: {},
                    capabilities: [],
                    pid: null,
                    createdAt: '',
                    dischargeDoor: true,
                    fillDoor: true,
                },
            ],
        });
        getStatus.mockResolvedValue({
            ...writableHeaterStatus,
            connected: true,
            machine_id: 'door-b',
            connection_epoch: 1,
            roaster: 'giesen_w45a_w60a',
            control: {
                ...writableHeaterStatus.control,
                discharge: true,
                fill: true,
            },
        });
        const view = await renderComposition({ ...base(), doorControlEntitled: true });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(view.get().discharge.available).toBe(true);
        expect(view.get().fill.available).toBe(true);
        let opened!: Promise<boolean>;
        await act(async () => {
            opened = view.get().discharge.send('open');
        });
        await view.unmount();
        const remounted = await renderComposition({ ...base(), doorControlEntitled: true });
        let blocked = true;
        await act(async () => {
            blocked = await remounted.get().fill.send('open');
            release({ ok: true });
            await opened;
        });
        expect(blocked).toBe(false);
        expect(sidecar.setDischarge).toHaveBeenCalledExactlyOnceWith('open', {
            machine_id: 'door-b',
            connection_epoch: 1,
        });
        expect(sidecar.setFill).not.toHaveBeenCalled();
        await remounted.unmount();
    });

    it('binds both controls to B among same-key machines and follows settings OFF/ON', async () => {
        const previous = useMachines.getState().machines;
        const common = {
            name: 'W60',
            displayName: 'W60',
            roasterKey: 'giesen_w45a_w60a',
            brand: 'Giesen',
            models: [],
            protocol: 's7',
            connectionParams: {},
            capabilities: [],
            pid: null,
            createdAt: '',
        };
        useMachines.setState({
            machines: [
                { ...common, id: 'a', dischargeDoor: true, fillDoor: true },
                { ...common, id: 'b', dischargeDoor: false, fillDoor: false },
            ],
        });
        const status = {
            ...writableHeaterStatus,
            machine_id: 'b',
            connection_epoch: 2,
            roaster: common.roasterKey,
            control: { ...writableHeaterStatus.control, discharge: false, fill: false },
        };
        getStatus.mockResolvedValue(status);
        const input = { ...base(), doorControlEntitled: true };
        const view = await renderComposition(input);
        try {
            expect(view.get().doorMachine?.id).toBe('b');
            expect(view.get().discharge.available).toBe(false);
            useMachines.getState().updateMachine('b', { dischargeDoor: true, fillDoor: true });
            await view.rerender(input);
            expect(view.get().discharge.available).toBe(false);
            getStatus.mockResolvedValue({ ...status, control: { ...status.control, discharge: true, fill: true } });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(view.get().discharge.available).toBe(true);
            expect(view.get().fill.available).toBe(true);
            await act(async () => {
                useMachines.getState().updateMachine('b', { dischargeDoor: false, fillDoor: false });
            });
            expect(view.get().discharge.available).toBe(false);
            expect(view.get().fill.available).toBe(false);
            await view.rerender({ ...input, reconnecting: true });
            expect(await view.get().fill.send('close')).toBe(false);
        } finally {
            await view.unmount();
            useMachines.setState({ machines: previous });
        }
    });

    it('PID engagement stops Replay and a later manual edit does not zero the burner', async () => {
        const hook = await renderComposition(base());
        await act(async () => {
            hook.get().replay.toggle();
        });
        expect(hook.get().replay.active).toBe(true);

        await hook.rerender({ ...base(), pidRuntime: runtime('running') });
        expect(hook.get().replay.active).toBe(false);
        expect(hook.get().replay.stopReason).toBe('pid');

        const callsBefore = setControl.mock.calls.length;
        act(() => {
            hook.get().changeManual('heater', 25);
        });
        expect(hook.get().replay.stopReason).toBe('pid');
        expect(setControl.mock.calls.slice(callsBefore).some(([cmd]) => cmd.heater === 0)).toBe(false);
        await hook.unmount();
    });

    it('manual heater edit after Replay OFF does not write a safe-off zero', async () => {
        const hook = await renderComposition(base());
        await act(async () => {
            hook.get().replay.toggle();
        });
        act(() => {
            hook.get().changeManual('heater', 25);
        });
        expect(hook.get().replay.active).toBe(false);
        expect(hook.get().replay.stopReason).toBe('manual');
        expect(setControl.mock.calls.some(([cmd]) => cmd.heater === 0)).toBe(false);
        await hook.unmount();
    });

    it('disconnect stops Replay without a follow-up heater write', async () => {
        const hook = await renderComposition(base());
        await act(async () => {
            hook.get().replay.toggle();
        });
        const callsBefore = setControl.mock.calls.length;
        await hook.rerender({ ...base(), sidecarConnected: false });
        expect(hook.get().replay.active).toBe(false);
        expect(hook.get().replay.stopReason).toBe('disconnected');
        expect(setControl.mock.calls.length).toBe(callsBefore);
        await hook.unmount();
    });
});
