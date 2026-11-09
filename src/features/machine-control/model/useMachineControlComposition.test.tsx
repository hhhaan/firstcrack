// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const features = vi.hoisted(() => ({ plan: 'pro_plus' }));
vi.mock('@shared/lib/features', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/features')>();
    return {
        ...actual,
        useFeature: (key: Parameters<typeof actual.useFeature>[0]) => actual.planHasFeature(features.plan, key),
    };
});

vi.mock('@shared/lib/sidecar', () => ({
    subscribeSidecarSettings: vi.fn(() => () => {}),
    sidecar: {
        getStatus: vi.fn(),
        setControl: vi.fn(),
        pidOn: vi.fn(),
        pidOff: vi.fn(),
        pidSetSv: vi.fn(),
        doorProbe: vi.fn(),
    },
}));
vi.mock('@shared/lib/logger', () => ({
    logger: { capture: vi.fn() },
}));
vi.mock('@shared/store/toast', () => ({
    useToastStore: { getState: () => ({ show: vi.fn() }) },
}));

import { logger } from '@shared/lib/logger';
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
const doorProbe = vi.mocked(sidecar.doorProbe);
const doorResult = (action: Awaited<ReturnType<typeof sidecar.doorProbe>>['action'], wrote: number | null) => ({
    action,
    wrote,
    command_before: null,
    command_after: null,
    command_held: null,
    discharge_open_before: null,
    discharge_open_after: null,
});

const verifiedHeaterStatus = {
    ...writableHeaterStatus,
    roaster: 'giesen_w45a_w60a',
    connection_epoch: 7,
    control: {
        ...writableHeaterStatus.control,
        limits: { heater: { min: 0, max: 100, unit: '%', verify_readback: true } },
    },
};

const giesenStatus = {
    ...verifiedHeaterStatus,
    control: {
        ...verifiedHeaterStatus.control,
        limits: {
            ...verifiedHeaterStatus.control.limits,
            fan: { min: 100, max: 170, unit: 'Pa', verify_readback: true },
            drum: { min: 40, max: 55, unit: 'Hz' },
        },
    },
};

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
        features.plan = 'pro_plus';
        getStatus.mockReset();
        setControl.mockReset();
        pidOff.mockReset();
        doorProbe.mockReset();
        vi.mocked(logger.capture).mockClear();
        getStatus.mockResolvedValue(writableHeaterStatus);
        setControl.mockImplementation(applyControl);
        pidOff.mockResolvedValue(offPidResponse);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ['fill_open', 1],
        ['discharge_open', 5],
    ] as const)('marks an acknowledged manual %s only after delivery', async (action, wrote) => {
        getStatus.mockResolvedValue(giesenStatus);
        const mark = vi.fn();
        const prepareDoorOpen = vi.fn(() => mark);
        const hook = await renderComposition({ ...base(), prepareDoorOpen });
        let finish!: (result: Awaited<ReturnType<typeof sidecar.doorProbe>>) => void;
        doorProbe.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        let sent!: ReturnType<typeof sidecar.doorProbe>;
        act(() => {
            sent = hook.get().sendDoorCommand(action);
        });
        expect(prepareDoorOpen).toHaveBeenCalledExactlyOnceWith(action);
        expect(mark).not.toHaveBeenCalled();
        await act(async () => {
            finish(doorResult(action, wrote));
            await sent;
        });
        expect(mark).toHaveBeenCalledOnce();
        expect(doorProbe).toHaveBeenCalledExactlyOnceWith(action);
        await hook.unmount();
    });

    it.each(['failure', 'uncertain', 'wrong-action', 'close', 'cooling', 'reconnect', 'epoch', 'unmount'] as const)(
        'does not mark %s delivery',
        async (boundary) => {
            getStatus.mockResolvedValue(giesenStatus);
            const mark = vi.fn();
            const input = { ...base(), prepareDoorOpen: vi.fn(() => mark) };
            const hook = await renderComposition(input);
            let finish!: (result: Awaited<ReturnType<typeof sidecar.doorProbe>>) => void;
            let fail!: (error: Error) => void;
            doorProbe.mockImplementationOnce(
                () =>
                    new Promise((resolve, reject) => {
                        finish = resolve;
                        fail = reject;
                    }),
            );
            const action = boundary === 'close' ? 'fill_close' : boundary === 'cooling' ? 'cooling_on' : 'fill_open';
            let sent!: Promise<unknown>;
            act(() => {
                sent = hook
                    .get()
                    .sendDoorCommand(action)
                    .catch(() => null);
            });
            if (boundary === 'reconnect') await hook.rerender({ ...input, reconnecting: true });
            if (boundary === 'epoch') {
                getStatus.mockResolvedValue({ ...giesenStatus, connection_epoch: 8 });
                await act(async () => vi.advanceTimersByTimeAsync(1000));
            }
            if (boundary === 'unmount') await hook.unmount();
            await act(async () => {
                if (boundary === 'failure') fail(new Error('delivery failed'));
                else
                    finish(
                        doorResult(
                            boundary === 'wrong-action' ? 'discharge_open' : action,
                            boundary === 'uncertain' ? null : 1,
                        ),
                    );
                await sent;
            });
            expect(mark).not.toHaveBeenCalled();
            if (boundary === 'close' || boundary === 'cooling') expect(input.prepareDoorOpen).not.toHaveBeenCalled();
            expect(doorProbe).toHaveBeenCalledOnce();
            if (boundary !== 'unmount') await hook.unmount();
        },
    );

    it('marks Replay discharge once through the shared sender and retains Drop-zero safety', async () => {
        getStatus.mockResolvedValue(giesenStatus);
        doorProbe.mockResolvedValue(doorResult('discharge_open', 5));
        const mark = vi.fn();
        const input: MachineControlCompositionInput = {
            ...base(),
            liveBt: 205,
            elapsed: 300,
            confirmedTurningPoint: {},
            pidDropBehavior: 'zero',
            diagnostics: { sessionId: 'command-drop-batch', receivedAtMs: null, sample: null },
            replayHeaterEvents: [{ kind: 'discharge_open', t: 300, bt: 205, trigger: 'bt' }],
            prepareDoorOpen: () => mark,
        };
        const hook = await renderComposition(input);
        await act(async () => hook.get().replay.toggle());
        expect(mark).toHaveBeenCalledOnce();
        expect(doorProbe).toHaveBeenCalledExactlyOnceWith('discharge_open', {
            connectionEpoch: 7,
            signal: expect.any(AbortSignal),
        });
        await hook.rerender({
            ...input,
            roastFinished: true,
            roasting: false,
            diagnostics: { sessionId: null, receivedAtMs: null, sample: null },
        });
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ heater: 0 });
        await hook.rerender({ ...input, roastFinished: false });
        await act(async () => hook.get().replay.toggle());
        expect(doorProbe).toHaveBeenCalledOnce();
        await hook.unmount();
    });

    it('allows Pro manual controls while blocking Replay toggle and saved Charge auto-start', async () => {
        features.plan = 'pro';
        getStatus.mockResolvedValue(giesenStatus);
        const input = { ...base(), roasting: false, elapsed: 0, replayOnCharge: true };
        const hook = await renderComposition(input);
        expect(hook.get().replay.available).toBe(false);
        await act(async () => hook.get().replay.toggle());
        expect(hook.get().replay.active).toBe(false);
        await hook.rerender({ ...input, roasting: true });
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(hook.get().replay.active).toBe(false);
        expect(setControl).not.toHaveBeenCalled();

        for (const [role, target] of [
            ['heater', 30],
            ['fan', 120],
            ['drum', 50],
        ] as const) {
            await act(async () => {
                hook.get().changeManual(role, target);
                hook.get().commitManual();
            });
        }
        expect(setControl.mock.calls).toEqual([[{ heater: 30 }], [{ fan: 120 }], [{ drum: 50 }]]);
        await hook.unmount();
    });

    it('stops Replay and cancels its pending retry when the plan changes to Pro', async () => {
        getStatus.mockResolvedValue(giesenStatus);
        setControl.mockRejectedValueOnce(new Error('write acknowledgement lost'));
        const input = { ...base(), elapsed: 0 };
        const hook = await renderComposition(input);
        await act(async () => hook.get().replay.toggle());
        expect(hook.get().replay.active).toBe(true);
        expect(setControl).toHaveBeenCalledTimes(1);
        features.plan = 'pro';
        await hook.rerender(input);
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(hook.get().replay.active).toBe(false);
        expect(hook.get().replay.available).toBe(false);
        expect(setControl).toHaveBeenCalledTimes(1);
        features.plan = 'pro_plus';
        await hook.rerender(input);
        expect(hook.get().replay.available).toBe(true);
        expect(hook.get().replay.active).toBe(false);
        await hook.unmount();
    });

    it('starts Replay on Charge only while the setting is on', async () => {
        const hook = await renderComposition({ ...base(), roasting: false, replayOnCharge: false });
        await hook.rerender({ ...base(), roasting: true, replayOnCharge: false });
        expect(hook.get().replay.active).toBe(false);

        await hook.rerender({ ...base(), roasting: false, replayOnCharge: true });
        await hook.rerender({ ...base(), roasting: true, replayOnCharge: true });
        expect(hook.get().replay.active).toBe(true);

        await act(async () => hook.get().replay.toggle());
        expect(hook.get().replay.active).toBe(false);
        await hook.rerender({ ...base(), roasting: true, elapsed: 40, replayOnCharge: true });
        expect(hook.get().replay.active).toBe(false);

        await hook.rerender({ ...base(), roasting: false, replayOnCharge: true });
        await hook.rerender({ ...base(), roasting: true, replayOnCharge: true });
        expect(hook.get().replay.active).toBe(true);
        await hook.unmount();
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

    it('preserves an unverified step after a sidecar readback failure without sending the next step', async () => {
        setControl.mockRejectedValueOnce(new Error('S7 setting readback mismatch'));
        const input: MachineControlCompositionInput = {
            ...base(),
            elapsed: 0,
            replayHeaterEvents: [
                { t: 0, bt: 180, heater: 0, trigger: 'time' },
                { t: 1, bt: 180, heater: 25, trigger: 'time' },
            ],
        };
        const hook = await renderComposition(input);
        await act(async () => hook.get().replay.toggle());
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ heater: 0 });
        expect(hook.get().replay.active).toBe(false);
        expect(hook.get().replay.stopReason).toBe('writeFailed');
        expect(hook.get().replay.firedCount).toBe(0);
        await hook.rerender({ ...input, elapsed: 1 });
        expect(setControl).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });

    it('automatically retries a failed Replay delivery with the original connection epoch', async () => {
        getStatus.mockResolvedValue({ ...writableHeaterStatus, connection_epoch: 7 });
        setControl.mockRejectedValueOnce(new Error('readback response lost'));
        const hook = await renderComposition({
            ...base(),
            elapsed: 0,
            replayHeaterEvents: [{ t: 0, bt: 180, heater: 0, trigger: 'time' }],
        });
        await act(async () => hook.get().replay.toggle());
        expect(hook.get().replay.active).toBe(true);
        expect(hook.get().replay.firedCount).toBe(0);
        expect(setControl).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(setControl).toHaveBeenLastCalledWith({ heater: 0 }, { connectionEpoch: 7 });
        expect(hook.get().replay.active).toBe(true);
        expect(hook.get().replay.firedCount).toBe(1);
        expect(hook.get().replay.stopReason).toBeNull();
        await hook.unmount();
    });

    it('retries a BBP manual slider write and records the user command once', async () => {
        getStatus.mockResolvedValue(verifiedHeaterStatus);
        setControl.mockRejectedValueOnce(new Error('readback mismatch'));
        const onHeaterCommitted = vi.fn();
        const hook = await renderComposition({ ...base(), roasting: false, onHeaterCommitted });
        await act(async () => {
            hook.get().changeManual('heater', 50);
            hook.get().commitManual();
        });
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ heater: 50 });
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(setControl.mock.calls).toEqual([[{ heater: 50 }], [{ heater: 50 }, { connectionEpoch: 7 }]]);
        expect(onHeaterCommitted).toHaveBeenCalledExactlyOnceWith(50, '%');
        expect(hook.get().machine.desired.heater).toBe(50);
        expect(logger.capture).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('enables airflow retries from status while PID owns only heat', async () => {
        const role = 'fan';
        getStatus.mockResolvedValue(giesenStatus);
        setControl.mockRejectedValueOnce(new Error('write lost'));
        const hook = await renderComposition({ ...base(), pidRuntime: runtime('running') });
        const target = 120;
        await act(async () => {
            hook.get().changeManual(role, target);
            hook.get().commitManual();
        });
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(setControl.mock.calls).toEqual([[{ [role]: target }], [{ [role]: target }, { connectionEpoch: 7 }]]);
        expect(hook.get().machine.desired[role]).toBe(target);
        expect(logger.capture).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('does not resend an acknowledged drum command while feedback takes seconds to rise', async () => {
        getStatus.mockResolvedValue(giesenStatus);
        const input = { ...base(), liveData: { heater: 40, fan: 110, drum: 40 } };
        const hook = await renderComposition(input);
        await act(async () => {
            hook.get().changeManual('drum', 50);
            hook.get().commitManual();
        });
        for (const drum of [41, 43, 45, 48, 50]) {
            await act(async () => vi.advanceTimersByTimeAsync(1000));
            await hook.rerender({ ...input, liveData: { ...input.liveData, drum } });
        }
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ drum: 50 });
        expect(logger.capture).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('reports a failed drum write once without automatically resending it', async () => {
        getStatus.mockResolvedValue(giesenStatus);
        setControl.mockRejectedValue(new Error('drum write failed'));
        const hook = await renderComposition(base());
        await act(async () => {
            hook.get().changeManual('drum', 50);
            hook.get().commitManual();
        });
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ drum: 50 });
        expect(logger.capture).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });

    it('cancels airflow retries immediately when reconnecting starts', async () => {
        const role = 'fan';
        getStatus.mockResolvedValue(giesenStatus);
        setControl.mockRejectedValueOnce(new Error('write lost'));
        const hook = await renderComposition(base());
        const target = 120;
        await act(async () => {
            hook.get().changeManual(role, target);
            hook.get().commitManual();
        });
        await hook.rerender({ ...base(), reconnecting: true });
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ [role]: target });
        await hook.unmount();
    });

    it('keeps a new slider draft after an old retry returns late', async () => {
        getStatus.mockResolvedValue(verifiedHeaterStatus);
        let finish!: (response: Awaited<ReturnType<typeof sidecar.setControl>>) => void;
        setControl.mockRejectedValueOnce(new Error('readback mismatch')).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const onApplied = vi.fn();
        const hook = await renderComposition({ ...base(), roasting: false, onApplied });
        await act(async () => {
            hook.get().changeManual('heater', 50);
            hook.get().commitManual();
        });
        await act(async () => vi.advanceTimersByTimeAsync(500));
        await act(async () => hook.get().changeManual('heater', 60));
        await act(async () => finish({ ok: true, applied: { heater: 50 } }));
        expect(hook.get().machine.desired.heater).toBe(60);
        expect(onApplied).not.toHaveBeenCalled();
        expect(setControl).toHaveBeenCalledTimes(2);
        await act(async () => hook.get().commitManual());
        expect(setControl).toHaveBeenLastCalledWith({ heater: 60 });
        expect(onApplied).toHaveBeenCalledExactlyOnceWith({ heater: 60 });
        await hook.unmount();
    });

    it.each(['new_input', 'pid', 'drop', 'reconnecting', 'disconnect', 'replay', 'unmount'] as const)(
        'cancels a manual retry when %s takes ownership',
        async (boundary) => {
            getStatus.mockResolvedValue(verifiedHeaterStatus);
            setControl.mockRejectedValueOnce(new Error('readback mismatch'));
            const input = { ...base(), elapsed: 0 };
            const hook = await renderComposition(input);
            await act(async () => {
                hook.get().changeManual('heater', 50);
                hook.get().commitManual();
            });
            if (boundary === 'new_input') await act(async () => hook.get().changeManual('heater', 60));
            if (boundary === 'pid') await hook.rerender({ ...input, pidRuntime: runtime('running') });
            if (boundary === 'drop') await hook.rerender({ ...input, roastFinished: true });
            if (boundary === 'reconnecting') await hook.rerender({ ...input, reconnecting: true });
            if (boundary === 'disconnect') await hook.rerender({ ...input, sidecarConnected: false });
            if (boundary === 'replay') await act(async () => hook.get().replay.toggle());
            if (boundary === 'unmount') await hook.unmount();
            await act(async () => vi.advanceTimersByTimeAsync(2000));
            expect(setControl.mock.calls.filter(([command]) => command.heater === 50)).toHaveLength(1);
            if (boundary !== 'unmount') await hook.unmount();
        },
    );

    it('does not blindly retry manual writes without readback support', async () => {
        getStatus.mockResolvedValue({ ...writableHeaterStatus, connection_epoch: 7 });
        setControl.mockRejectedValue(new Error('write failed'));
        const hook = await renderComposition({ ...base(), roasting: false });
        await act(async () => {
            hook.get().changeManual('heater', 50);
            hook.get().commitManual();
        });
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ heater: 50 });
        await hook.unmount();
    });

    it('cancels the old manual retry when status reports a new connection epoch', async () => {
        getStatus.mockResolvedValue(verifiedHeaterStatus);
        const hook = await renderComposition({ ...base(), roasting: false });
        await act(async () => vi.advanceTimersByTimeAsync(900));
        setControl.mockRejectedValueOnce(new Error('readback mismatch'));
        await act(async () => {
            hook.get().changeManual('heater', 50);
            hook.get().commitManual();
        });
        getStatus.mockResolvedValue({ ...verifiedHeaterStatus, connection_epoch: 8 });
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(hook.get().machine.connectionStatus?.connection_epoch).toBe(8);
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ heater: 50 });
        await hook.unmount();
    });

    it('stops only after the bounded retry budget is exhausted', async () => {
        getStatus.mockResolvedValue({ ...writableHeaterStatus, connection_epoch: 7 });
        setControl.mockRejectedValue(new Error('PLC unavailable'));
        const hook = await renderComposition({
            ...base(),
            elapsed: 0,
            replayHeaterEvents: [{ t: 0, bt: 180, heater: 0, trigger: 'time' }],
        });
        await act(async () => hook.get().replay.toggle());
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(setControl.mock.calls).toEqual([
            [{ heater: 0 }],
            [{ heater: 0 }, { connectionEpoch: 7 }],
            [{ heater: 0 }, { connectionEpoch: 7 }],
        ]);
        expect(hook.get().replay.active).toBe(false);
        expect(hook.get().replay.stopReason).toBe('writeFailed');
        expect(hook.get().replay.firedCount).toBe(0);
        await hook.unmount();
    });

    it('cancels scheduled retries before a manual heater commit', async () => {
        getStatus.mockResolvedValue({ ...writableHeaterStatus, connection_epoch: 7 });
        setControl.mockRejectedValueOnce(new Error('PLC write failed'));
        const hook = await renderComposition({ ...base(), elapsed: 0 });
        await act(async () => hook.get().replay.toggle());
        await act(async () => {
            hook.get().changeManual('heater', 30);
            hook.get().commitManual();
        });
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(setControl.mock.calls).toEqual([[{ heater: 60 }], [{ heater: 30 }]]);
        expect(hook.get().replay.stopReason).toBe('manual');
        expect(hook.get().replay.firedCount).toBe(0);
        await hook.unmount();
    });

    it('reports acknowledged gas-off with nonzero feedback while Replay stays on and sends no extra commands', async () => {
        getStatus.mockResolvedValue({ ...writableHeaterStatus, capabilities: ['heater'] });
        const input: MachineControlCompositionInput = {
            ...base(),
            elapsed: 0,
            replayHeaterEvents: [{ t: 0, bt: 180, heater: 0, trigger: 'time' }],
            diagnostics: {
                sessionId: 'batch-1',
                receivedAtMs: Date.now(),
                sample: { heater: 19, timestamp: 100, sensor_clock: 'clock-1' },
            },
        };
        const hook = await renderComposition(input);
        await act(async () => hook.get().replay.toggle());
        expect(setControl).toHaveBeenCalledExactlyOnceWith({ heater: 0 });
        for (let second = 1; second <= 5; second++) {
            await act(async () => vi.advanceTimersByTimeAsync(1000));
            await hook.rerender({
                ...input,
                elapsed: second,
                diagnostics: {
                    sessionId: 'batch-1',
                    receivedAtMs: Date.now(),
                    sample: { heater: 19, timestamp: 100 + second, sensor_clock: 'clock-1' },
                },
            });
        }
        expect(logger.capture).toHaveBeenCalledExactlyOnceWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.objectContaining({ sessionId: 'batch-1', origins: ['replay'], requested: 0, applied: 0 }),
            }),
        );
        expect(hook.get().replay.active).toBe(true);
        expect(hook.get().replay.stopReason).toBeNull();
        expect(setControl).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });

    it('clears an outstanding zero diagnostic when the composition unmounts', async () => {
        getStatus.mockResolvedValue({ ...writableHeaterStatus, capabilities: ['heater'] });
        const hook = await renderComposition({
            ...base(),
            diagnostics: { sessionId: 'batch-1', receivedAtMs: Date.now(), sample: { heater: 19, timestamp: 100 } },
        });
        await act(async () => {
            hook.get().changeManual('heater', 0);
            hook.get().commitManual();
        });
        await hook.unmount();
        await act(async () => vi.advanceTimersByTimeAsync(10000));
        expect(logger.capture).not.toHaveBeenCalled();
    });
});
