import { captureReplayDeliveryResult, type ReplayDeliveryOutcome } from '@shared/lib/sentry';

export const REPLAY_DELIVERY_LIMIT = 3;
export const REPLAY_RETRY_DELAY_MS = 500;

const pauseForRetry = (signal: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve(false);
        const finish = (ready: boolean) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
            resolve(ready);
        };
        const cancel = () => finish(false);
        const timer = setTimeout(() => finish(true), REPLAY_RETRY_DELAY_MS);
        signal.addEventListener('abort', cancel, { once: true });
    });

/** Keep one step pending through delivery and confirmation; owner cancellation wins over late responses. */
export const deliverReplayStep = async ({
    target,
    write,
    retry,
    signal,
    onAttempt,
    sessionId,
    connectionEpoch,
}: {
    target: number;
    write: (target: number) => Promise<number | null>;
    retry?: (target: number) => Promise<number | null>;
    signal: AbortSignal;
    onAttempt: (attempt: number) => void;
    sessionId?: string | null;
    connectionEpoch?: number;
}): Promise<boolean> => {
    const cancelled = () => signal.aborted;
    const startedAt = Date.now();
    let attempts = 0;
    let failed = false;
    let lastApplied: number | null = null;
    const finish = (outcome: ReplayDeliveryOutcome) => {
        if (failed) {
            captureReplayDeliveryResult({
                outcome,
                target,
                attempts,
                lastApplied,
                sessionId,
                connectionEpoch,
                elapsedMs: Date.now() - startedAt,
            });
        }
        return outcome === 'recovered';
    };
    for (let attempt = 1; attempt <= REPLAY_DELIVERY_LIMIT; attempt++) {
        if (cancelled()) return finish('cancelled');
        const send = attempt === 1 ? write : retry;
        if (!send) return finish('retry_unavailable');
        if (attempt > 1 && !(await pauseForRetry(signal))) return finish('cancelled');
        if (cancelled()) return finish('cancelled');
        attempts = attempt;
        onAttempt(attempt);
        let applied: number | null;
        try {
            applied = await send(target);
        } catch {
            applied = null;
        }
        lastApplied = applied;
        failed ||= applied !== target;
        if (cancelled()) return finish('cancelled');
        if (applied === target) return finish('recovered');
    }
    return finish('exhausted');
};
