import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPollLoop } from './useSidecarPolling';

const deferred = () => {
    let resolve: (value?: unknown) => void = () => {};
    let reject: (err?: unknown) => void = () => {};
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

describe('startPollLoop (#210)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts immediately with one poll', () => {
        const poll = vi.fn(() => new Promise(() => {}));
        const stop = startPollLoop(poll, 500);
        expect(poll).toHaveBeenCalledTimes(1);
        stop();
    });

    it('does not pile up while a poll is in flight', async () => {
        const poll = vi.fn(() => new Promise(() => {}));
        const stop = startPollLoop(poll, 500);

        await vi.advanceTimersByTimeAsync(1500);
        expect(poll).toHaveBeenCalledTimes(1);
        stop();
    });

    it('schedules the next poll after resolve + interval', async () => {
        const gate = deferred();
        const poll = vi.fn(() => gate.promise);
        const stop = startPollLoop(poll, 500);

        expect(poll).toHaveBeenCalledTimes(1);
        gate.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);
        expect(poll).toHaveBeenCalledTimes(2);
        stop();
    });

    it('keeps looping after poll rejects', async () => {
        const first = deferred();
        const poll = vi.fn(() => first.promise);
        const stop = startPollLoop(poll, 500);

        first.reject(new Error('timeout'));
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);
        expect(poll).toHaveBeenCalledTimes(2);
        stop();
    });

    it('does not call again after stop()', async () => {
        const poll = vi.fn(async () => {});
        const stop = startPollLoop(poll, 500);

        await Promise.resolve();
        stop();
        await vi.advanceTimersByTimeAsync(2000);
        expect(poll).toHaveBeenCalledTimes(1);
    });

    it('does not reschedule if stop() is called while in flight', async () => {
        const gate = deferred();
        const poll = vi.fn(() => gate.promise);
        const stop = startPollLoop(poll, 500);

        stop();
        gate.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1500);
        expect(poll).toHaveBeenCalledTimes(1);
    });

    it('waits the full interval after a slow poll completes', async () => {
        const gate = deferred();
        const poll = vi.fn(() => gate.promise);
        const stop = startPollLoop(poll, 500);

        await vi.advanceTimersByTimeAsync(1800);
        expect(poll).toHaveBeenCalledTimes(1);

        gate.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(499);
        expect(poll).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(poll).toHaveBeenCalledTimes(2);
        stop();
    });
});

describe('useSidecarPolling temp-poll wiring (structural)', () => {
    it('temperature effect uses startPollLoop, not setInterval', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('./useSidecarPolling.ts', import.meta.url), 'utf8');
        expect(typeof (await import('./useSidecarPolling')).startPollLoop).toBe('function');
        expect(src).toContain('return startPollLoop(poll, pollIntervalMs)');
        // idle /status stays on a light setInterval; only the temp loop is self-scheduled
        expect(src).toMatch(/setInterval\(check, IDLE_STATUS_POLL_MS\)/);
        expect(src).not.toMatch(/setInterval\(\(\) => void poll\(\)/);
    });
});
