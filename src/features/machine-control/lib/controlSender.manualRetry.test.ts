import { captureHeaterDeliveryResult } from '@shared/lib/sentry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ControlCommand, type ControlRetry, createControlSender } from './controlSender';
import { HEATER_RETRY_DELAY_MS } from './heaterDelivery';

vi.mock('@shared/lib/sentry', () => ({ captureHeaterDeliveryResult: vi.fn() }));

const setup = () => {
    const send = vi.fn<(command: ControlCommand, retry?: ControlRetry) => Promise<ControlCommand>>();
    send.mockImplementation(async (command) => command);
    const onApplied = vi.fn();
    const onError = vi.fn();
    const onCommitted = vi.fn();
    const sender = createControlSender({ send, onApplied, onError, onCommitted });
    sender.setManualRetryEpoch('heater', 7);
    return { sender, send, onApplied, onError, onCommitted };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('manual heater delivery', () => {
    it('retries a failed write with the original connection epoch and commits the user action once', async () => {
        const { sender, send, onError, onCommitted, onApplied } = setup();
        send.mockRejectedValueOnce(new Error('readback mismatch'));
        sender.queue('heater', 0);
        const pending = sender.commitNow();
        await vi.advanceTimersByTimeAsync(HEATER_RETRY_DELAY_MS - 1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toEqual({ heater: 0 });
        expect(send.mock.calls).toEqual([[{ heater: 0 }], [{ heater: 0 }, { connectionEpoch: 7 }]]);
        expect(onCommitted).toHaveBeenCalledExactlyOnceWith({ heater: 0 });
        expect(onApplied).toHaveBeenCalledExactlyOnceWith({ heater: 0 });
        expect(onError).not.toHaveBeenCalled();
        expect(captureHeaterDeliveryResult).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                origin: 'manual',
                outcome: 'recovered',
                attempts: 2,
                target: 0,
                connectionEpoch: 7,
            }),
        );
    });

    it('stops after three attempts and reports one final error', async () => {
        const { sender, send, onError } = setup();
        const error = new Error('readback mismatch');
        send.mockRejectedValue(error);
        sender.queue('heater', 50);
        const pending = sender.commitNow();
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(pending).resolves.toBeNull();
        expect(send).toHaveBeenCalledTimes(3);
        expect(onError).toHaveBeenCalledExactlyOnceWith(error, { heater: 'manual' });
        expect(captureHeaterDeliveryResult).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                origin: 'manual',
                outcome: 'exhausted',
                attempts: 3,
            }),
        );
    });

    it('accepts an acknowledged machine clamp rather than retrying a successfully applied value', async () => {
        const { sender, send } = setup();
        send.mockResolvedValue({ heater: 100 });
        sender.queue('heater', 120);
        await expect(sender.commitNow()).resolves.toEqual({ heater: 100 });
        expect(send).toHaveBeenCalledTimes(1);
        expect(captureHeaterDeliveryResult).not.toHaveBeenCalled();
    });

    it('cancels a waiting retry on the next drag input without sending its draft', async () => {
        const { sender, send, onApplied, onError } = setup();
        send.mockRejectedValueOnce(new Error('readback mismatch'));
        sender.queue('heater', 50);
        const first = sender.commitNow();
        await vi.advanceTimersByTimeAsync(100);
        sender.queue('heater', 60);
        await expect(first).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(send).toHaveBeenCalledTimes(1);
        expect(onApplied).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        await expect(sender.commitNow()).resolves.toEqual({ heater: 60 });
        expect(send.mock.calls).toEqual([[{ heater: 50 }], [{ heater: 60 }]]);
        expect(captureHeaterDeliveryResult).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                outcome: 'cancelled',
                attempts: 1,
            }),
        );
    });

    it('ignores a late retry acknowledgement and serializes the newer command after it', async () => {
        const { sender, send, onApplied, onError } = setup();
        let finish!: (value: ControlCommand) => void;
        send.mockRejectedValueOnce(new Error('readback mismatch')).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        sender.queue('heater', 50);
        const old = sender.commitNow();
        await vi.advanceTimersByTimeAsync(HEATER_RETRY_DELAY_MS);
        sender.queue('heater', 60);
        const latest = sender.commitNow();
        expect(send).toHaveBeenCalledTimes(2);
        finish({ heater: 50 });
        await expect(old).resolves.toBeNull();
        await expect(latest).resolves.toEqual({ heater: 60 });
        expect(send.mock.calls).toEqual([[{ heater: 50 }], [{ heater: 50 }, { connectionEpoch: 7 }], [{ heater: 60 }]]);
        expect(onApplied).toHaveBeenCalledExactlyOnceWith({ heater: 60 });
        expect(onError).not.toHaveBeenCalled();
        expect(captureHeaterDeliveryResult).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                outcome: 'cancelled',
                attempts: 2,
            }),
        );
    });

    it('does not revive an old retry when the user moves away and back to the same number', async () => {
        const { sender, send } = setup();
        send.mockRejectedValueOnce(new Error('readback mismatch'));
        sender.queue('heater', 50);
        const old = sender.commitNow();
        await vi.advanceTimersByTimeAsync(100);
        sender.queue('heater', 60);
        sender.queue('heater', 50);
        await expect(old).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(1000);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('drops superseded queued heater input while preserving a committed fan command', async () => {
        const { sender, send } = setup();
        let finish!: (value: ControlCommand) => void;
        send.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        sender.queue('drum', 45);
        const first = sender.commitNow();
        sender.queue('heater', 50);
        sender.queue('fan', 70);
        const queued = sender.commitNow();
        sender.queue('heater', 60);
        finish({ drum: 45 });
        await first;
        await expect(queued).resolves.toEqual({ fan: 70 });
        expect(send.mock.calls).toEqual([[{ drum: 45 }], [{ fan: 70 }]]);
        await expect(sender.commitNow()).resolves.toEqual({ heater: 60 });
    });

    it.each(['dispose', 'connection', 'unsupported', 'owner'] as const)(
        'cancels a waiting retry on %s',
        async (boundary) => {
            const { sender, send } = setup();
            send.mockRejectedValueOnce(new Error('readback mismatch'));
            sender.queue('heater', 50);
            const pending = sender.commitNow();
            await vi.advanceTimersByTimeAsync(100);
            if (boundary === 'dispose') sender.dispose();
            if (boundary === 'connection') sender.setManualRetryEpoch('heater', 8);
            if (boundary === 'unsupported') sender.setManualRetryEpoch('heater', undefined);
            if (boundary === 'owner') sender.cancelManualHeaterRetry();
            await expect(pending).resolves.toBeNull();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(send).toHaveBeenCalledTimes(1);
        },
    );

    it('only retries heater from a failed mixed command and leaves fan failure visible', async () => {
        const { sender, send, onError, onApplied } = setup();
        const error = new Error('mixed write failed');
        send.mockRejectedValueOnce(error);
        sender.queue('heater', 50);
        sender.queue('fan', 70);
        const pending = sender.commitNow();
        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).resolves.toEqual({ heater: 50 });
        expect(send.mock.calls).toEqual([[{ heater: 50, fan: 70 }], [{ heater: 50 }, { connectionEpoch: 7 }]]);
        expect(onError).toHaveBeenCalledExactlyOnceWith(error, { fan: 'manual' });
        expect(onApplied).toHaveBeenCalledExactlyOnceWith({ heater: 50 });
    });

    it.each([8, undefined])('does not transfer queued manual heat to connection/owner %s', async (epoch) => {
        const { sender, send } = setup();
        let finish!: (value: ControlCommand) => void;
        send.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        sender.queue('fan', 70);
        const first = sender.commitNow();
        sender.queue('heater', 50);
        const old = sender.commitNow();
        sender.setManualRetryEpoch('heater', epoch);
        finish({ fan: 70 });
        await first;
        await expect(old).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(2000);
        expect(send.mock.calls).toEqual([[{ fan: 70 }]]);
    });

    it.each(['unsupported', 'fan', 'replay', 'safety'] as const)('does not add manual retries to %s', async (kind) => {
        const { sender, send } = setup();
        send.mockRejectedValue(new Error('write failed'));
        if (kind === 'unsupported') sender.setManualRetryEpoch('heater', undefined);
        sender.queue(kind === 'fan' ? 'fan' : 'heater', 50);
        const pending = sender.commitNow(kind === 'replay' ? 'replay' : kind === 'safety' ? 'safety' : 'manual');
        await expect(pending).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe('manual airflow delivery', () => {
    const role = 'fan';
    const prepare = () => {
        const context = setup();
        context.sender.setManualRetryEpoch(role, 7);
        return context;
    };

    it('retries a failed delivery, records once, and does not report it as heater delivery', async () => {
        const { sender, send, onCommitted, onApplied, onError } = prepare();
        send.mockRejectedValueOnce(new Error('write acknowledgement lost'));
        sender.queue(role, 50);
        const pending = sender.commitNow();
        await vi.advanceTimersByTimeAsync(499);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toEqual({ [role]: 50 });
        expect(send.mock.calls).toEqual([[{ [role]: 50 }], [{ [role]: 50 }, { connectionEpoch: 7 }]]);
        expect(onCommitted).toHaveBeenCalledExactlyOnceWith({ [role]: 50 });
        expect(onApplied).toHaveBeenCalledExactlyOnceWith({ [role]: 50 });
        expect(onError).not.toHaveBeenCalled();
        expect(captureHeaterDeliveryResult).not.toHaveBeenCalled();
    });

    it('stops after two retries and reports the affected role once', async () => {
        const { sender, send, onError } = prepare();
        const error = new Error('write unavailable');
        send.mockRejectedValue(error);
        sender.queue(role, 50);
        const pending = sender.commitNow();
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(pending).resolves.toBeNull();
        expect(send).toHaveBeenCalledTimes(3);
        expect(onError).toHaveBeenCalledExactlyOnceWith(error, { [role]: 'manual' });
    });

    it('accepts a clamped acknowledgement without scheduling another write', async () => {
        const { sender, send } = prepare();
        send.mockResolvedValue({ [role]: 55 });
        sender.queue(role, 999);
        await expect(sender.commitNow()).resolves.toEqual({ [role]: 55 });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it.each(['input', 'epoch', 'unsupported', 'dispose'] as const)('cancels an old retry on %s', async (boundary) => {
        const { sender, send, onError } = prepare();
        send.mockRejectedValueOnce(new Error('write lost'));
        sender.queue(role, 50);
        const pending = sender.commitNow();
        await vi.advanceTimersByTimeAsync(100);
        if (boundary === 'input') sender.queue(role, 51);
        if (boundary === 'epoch') sender.setManualRetryEpoch(role, 8);
        if (boundary === 'unsupported') sender.setManualRetryEpoch(role, undefined);
        if (boundary === 'dispose') sender.dispose();
        await expect(pending).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(send).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });

    it('ignores a late retry ACK before sending the newer value', async () => {
        const { sender, send, onApplied } = prepare();
        let finish!: (result: ControlCommand) => void;
        send.mockRejectedValueOnce(new Error('write lost')).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        sender.queue(role, 50);
        const old = sender.commitNow();
        await vi.advanceTimersByTimeAsync(500);
        sender.queue(role, 51);
        const latest = sender.commitNow();
        expect(send).toHaveBeenCalledTimes(2);
        finish({ [role]: 50 });
        await expect(old).resolves.toBeNull();
        await expect(latest).resolves.toEqual({ [role]: 51 });
        expect(onApplied).toHaveBeenCalledExactlyOnceWith({ [role]: 51 });
    });
});

it('recovers a mixed batch per role, without resending successful heater or drum values', async () => {
    const { sender, send, onError } = setup();
    sender.setManualRetryEpoch('fan', 7);
    send.mockImplementation(async (cmd, retry) => {
        if (!retry) return { heater: 40, drum: 50 };
        return cmd;
    });
    sender.queue('heater', 40);
    sender.queue('fan', 120);
    sender.queue('drum', 50);
    const pending = sender.commitNow();
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ heater: 40, fan: 120, drum: 50 });
    expect(send.mock.calls).toEqual([[{ heater: 40, fan: 120, drum: 50 }], [{ fan: 120 }, { connectionEpoch: 7 }]]);
    expect(onError).not.toHaveBeenCalled();
});

it('preserves fan recovery when heater retries exhaust and reports only the failed heater', async () => {
    const { sender, send, onError } = setup();
    sender.setManualRetryEpoch('fan', 7);
    const error = new Error('heater unavailable');
    send.mockImplementation(async (cmd) => {
        if (cmd.heater != null) throw error;
        return cmd;
    });
    sender.queue('heater', 40);
    sender.queue('fan', 120);
    const pending = sender.commitNow();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ fan: 120 });
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, { heater: 'manual' });
    expect(send.mock.calls).toEqual([
        [{ heater: 40, fan: 120 }],
        [{ heater: 40 }, { connectionEpoch: 7 }],
        [{ heater: 40 }, { connectionEpoch: 7 }],
        [{ fan: 120 }, { connectionEpoch: 7 }],
    ]);
});

it('heater ownership changes do not cancel an airflow retry', async () => {
    const { sender, send, onError } = setup();
    sender.setManualRetryEpoch('fan', 7);
    send.mockRejectedValueOnce(new Error('write lost'));
    sender.queue('fan', 120);
    const pending = sender.commitNow();
    await vi.advanceTimersByTimeAsync(100);
    sender.queue('heater', 40);
    sender.cancelManualHeaterRetry();
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ fan: 120 });
    expect(send.mock.calls).toEqual([[{ fan: 120 }], [{ fan: 120 }, { connectionEpoch: 7 }]]);
    expect(onError).not.toHaveBeenCalled();
    await expect(sender.commitNow()).resolves.toEqual({ heater: 40 });
});

it('reports a failed drum command without retrying it after a mixed batch fails', async () => {
    const { sender, send, onError } = setup();
    sender.setManualRetryEpoch('fan', 7);
    const error = new Error('mixed write failed');
    send.mockRejectedValueOnce(error);
    sender.queue('fan', 120);
    sender.queue('drum', 50);
    const pending = sender.commitNow();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ fan: 120 });
    expect(send.mock.calls).toEqual([[{ fan: 120, drum: 50 }], [{ fan: 120 }, { connectionEpoch: 7 }]]);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, { drum: 'manual' });
});
