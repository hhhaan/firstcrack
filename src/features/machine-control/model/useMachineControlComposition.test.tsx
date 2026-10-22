// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/sidecar', () => ({
    subscribeSidecarSettings: vi.fn(() => () => {}),
    sidecar: {
        getStatus: vi.fn(),
        claimReplay: vi.fn(async () => ({
            ok: true,
            ticket: { connection_epoch: 7, generation: 1, origin: 'replay' },
        })),
        releaseReplay: vi.fn(async () => ({ ok: true })),
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
        vi.mocked(logger.capture).mockClear();
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
        expect(setControl).toHaveBeenCalledExactlyOnceWith(
            { heater: 0 },
            expect.objectContaining({ origin: 'replay', generation: 1, connection_epoch: 7 }),
        );
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
        expect(setControl).toHaveBeenLastCalledWith(
            { heater: 0 },
            expect.objectContaining({ origin: 'replay', generation: 1, retry_epoch: 7 }),
        );
        expect(hook.get().replay.active).toBe(true);
        expect(hook.get().replay.firedCount).toBe(1);
        expect(hook.get().replay.stopReason).toBeNull();
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
            [{ heater: 0 }, expect.objectContaining({ origin: 'replay', generation: 1 })],
            [{ heater: 0 }, expect.objectContaining({ origin: 'replay', generation: 1, retry_epoch: 7 })],
            [{ heater: 0 }, expect.objectContaining({ origin: 'replay', generation: 1, retry_epoch: 7 })],
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
        expect(setControl.mock.calls).toEqual([
            [{ heater: 60 }, expect.objectContaining({ origin: 'replay' })],
            [{ heater: 30 }, expect.objectContaining({ origin: 'manual', takeover: true })],
        ]);
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
        expect(setControl).toHaveBeenCalledExactlyOnceWith(
            { heater: 0 },
            expect.objectContaining({ origin: 'replay', generation: 1, connection_epoch: 7 }),
        );
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
    it('does not activate a delayed Replay claim after a manual heater takeover', async () => {
        const hook = await renderComposition(base());
        let resolveClaim!: (result: Awaited<ReturnType<typeof sidecar.claimReplay>>) => void;
        vi.mocked(sidecar.claimReplay).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveClaim = resolve;
                }),
        );
        await act(async () => hook.get().replay.toggle());
        expect(setControl).not.toHaveBeenCalled();
        await act(async () => {
            hook.get().changeManual('heater', 25);
            hook.get().commitManual();
        });
        const ticket = { connection_epoch: 7, generation: 1, origin: 'replay' } as const;
        await act(async () => {
            resolveClaim({ ok: true, ticket });
        });
        expect(setControl.mock.calls.map(([cmd]) => cmd)).toEqual([{ heater: 25 }]);
        expect(sidecar.releaseReplay).toHaveBeenCalledWith(ticket);
        expect(hook.get().replay.active).toBe(false);
        hook.unmount();
    });

    it('manual fan and drum changes keep the Replay heater ticket', async () => {
        const hook = await renderComposition(base());
        await act(async () => hook.get().replay.toggle());
        const claims = vi.mocked(sidecar.claimReplay).mock.calls.length;
        const releases = vi.mocked(sidecar.releaseReplay).mock.calls.length;
        await act(async () => {
            hook.get().changeManual('fan', 55);
            hook.get().changeManual('drum', 60);
            hook.get().commitManual();
        });
        expect(hook.get().replay.active).toBe(true);
        expect(vi.mocked(sidecar.claimReplay).mock.calls).toHaveLength(claims);
        expect(vi.mocked(sidecar.releaseReplay).mock.calls).toHaveLength(releases);
        expect(setControl).toHaveBeenLastCalledWith({ fan: 55, drum: 60 }, undefined);
        hook.unmount();
    });
});
