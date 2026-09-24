// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
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

import { sidecar } from '@shared/lib/sidecar';
import { type MachineControlCompositionInput, useMachineControlComposition } from './useMachineControlComposition';
import {
    baseMachineControlInput as base,
    replayPoints as POINTS,
    pidRuntime as runtime,
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
        getStatus.mockResolvedValue({
            control: {
                writable: true,
                limits: { heater: { min: 0, max: 100, unit: '%' } },
                pid: { supported: true, sv_min: 50, sv_max: 250 },
            },
        } as Awaited<ReturnType<typeof sidecar.getStatus>>);
        setControl.mockImplementation(
            async (cmd) => ({ applied: cmd }) as Awaited<ReturnType<typeof sidecar.setControl>>,
        );
        pidOff.mockResolvedValue({ ok: true, pid: runtime('off') } as Awaited<ReturnType<typeof sidecar.pidOff>>);
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
