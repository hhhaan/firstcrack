import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverReplayStep, REPLAY_RETRY_DELAY_MS } from './replayDelivery';

afterEach(() => vi.useRealTimers());

describe('Replay step delivery', () => {
    it('recovers after a lost acknowledgement without consuming another step', async () => {
        vi.useFakeTimers();
        const write = vi.fn(async () => null);
        const retry = vi.fn(async () => 0);
        const attempts = vi.fn();
        const result = deliverReplayStep({
            target: 0,
            write,
            retry,
            signal: new AbortController().signal,
            onAttempt: attempts,
        });
        await vi.advanceTimersByTimeAsync(REPLAY_RETRY_DELAY_MS - 1);
        expect(retry).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toBe(true);
        expect(write).toHaveBeenCalledExactlyOnceWith(0);
        expect(retry).toHaveBeenCalledExactlyOnceWith(0);
        expect(attempts.mock.calls).toEqual([[1], [2]]);
    });

    it('uses a third attempt after a retry error and stops scheduling after success', async () => {
        vi.useFakeTimers();
        const retry = vi.fn(async () => 0).mockRejectedValueOnce(new Error('temporary read failure'));
        const result = deliverReplayStep({
            target: 0,
            write: async () => 7,
            retry,
            signal: new AbortController().signal,
            onAttempt: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(REPLAY_RETRY_DELAY_MS * 2);
        await expect(result).resolves.toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(retry).toHaveBeenCalledTimes(2);
    });

    it('exhausts after three total attempts without an unbounded retry loop', async () => {
        vi.useFakeTimers();
        const write = vi.fn(async () => null);
        const retry = vi.fn(async () => 7);
        const result = deliverReplayStep({
            target: 0,
            write,
            retry,
            signal: new AbortController().signal,
            onAttempt: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(result).resolves.toBe(false);
        expect(write).toHaveBeenCalledTimes(1);
        expect(retry).toHaveBeenCalledTimes(2);
    });

    it('cancels a scheduled retry immediately when the owner aborts', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const retry = vi.fn(async () => 0);
        const result = deliverReplayStep({
            target: 0,
            write: async () => null,
            retry,
            signal: controller.signal,
            onAttempt: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(100);
        controller.abort();
        await expect(result).resolves.toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(retry).not.toHaveBeenCalled();
    });

    it('does not accept or retry a response belonging to an aborted owner', async () => {
        const controller = new AbortController();
        const retry = vi.fn(async () => 0);
        let finish!: (value: number) => void;
        const result = deliverReplayStep({
            target: 0,
            write: () =>
                new Promise<number>((resolve) => {
                    finish = resolve;
                }),
            retry,
            signal: controller.signal,
            onAttempt: vi.fn(),
        });
        controller.abort();
        finish(0);
        await expect(result).resolves.toBe(false);
        expect(retry).not.toHaveBeenCalled();
    });
});
