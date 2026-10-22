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
}: {
    target: number;
    write: (target: number) => Promise<number | null>;
    retry?: (target: number) => Promise<number | null>;
    signal: AbortSignal;
    onAttempt: (attempt: number) => void;
}): Promise<boolean> => {
    const cancelled = () => signal.aborted;
    for (let attempt = 1; attempt <= REPLAY_DELIVERY_LIMIT; attempt++) {
        if (cancelled()) return false;
        const send = attempt === 1 ? write : retry;
        if (!send) return false;
        if (attempt > 1 && !(await pauseForRetry(signal))) return false;
        if (cancelled()) return false;
        onAttempt(attempt);
        let applied: number | null;
        try {
            applied = await send(target);
        } catch {
            applied = null;
        }
        if (cancelled()) return false;
        if (applied === target) return true;
    }
    return false;
};
