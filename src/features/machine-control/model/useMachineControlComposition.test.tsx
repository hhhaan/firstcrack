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
    logger: { capture: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn(), info: vi.fn() },
}));
vi.mock('@shared/store/toast', () => ({
    useToastStore: { getState: () => ({ show: vi.fn() }) },
}));

import type { PidRuntime } from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import type { ReplayPoint } from '../lib/replay';
import { type MachineControlCompositionInput, useMachineControlComposition } from './useMachineControlComposition';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getStatus = vi.mocked(sidecar.getStatus);
const setControl = vi.mocked(sidecar.setControl);
const pidOff = vi.mocked(sidecar.pidOff);

const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heaterSet: 60 },
    { t: 60, bt: 95, heaterSet: 60 },
    { t: 120, bt: 110, heaterSet: 40 },
];

const runtime = (state: PidRuntime['state']): PidRuntime => ({
    state,
    sv: 200,
    duty: 40,
    pv: 180,
    p: 0,
    i: 0,
    d: 0,
    error: null,
});

const base = (): MachineControlCompositionInput => ({
    sidecarConnected: true,
    reconnecting: false,
    liveData: { heater: 40, fan: 0, drum: 0 },
    pidRuntime: null,
    roastFinished: false,
    pidDropBehavior: 'hold',
    replayPoints: POINTS,
    replayMachineMismatch: false,
    replayDropTime: null,
    liveBt: 180,
    elapsed: 30,
    roasting: true,
    confirmedTurningPoint: null,
    observationQuality: 'valid',
});

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
