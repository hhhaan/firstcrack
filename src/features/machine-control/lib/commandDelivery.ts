export const COMMAND_DELIVERY_LIMIT = 3;
export const COMMAND_RETRY_DELAY_MS = 500;

type DeliveryOutcome = 'recovered' | 'cancelled' | 'retry_unavailable' | 'exhausted';

const pauseForRetry = (signal: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve(false);
        const finish = (ready: boolean) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
            resolve(ready);
        };
        const cancel = () => finish(false);
        const timer = setTimeout(() => finish(true), COMMAND_RETRY_DELAY_MS);
        signal.addEventListener('abort', cancel, { once: true });
    });

/** Delivery retries are independent of the time physical feedback takes to settle. */
export const deliverCommand = async ({
    target,
    write,
    retry,
    signal,
    acceptClamped = false,
    onAttempt,
}: {
    target: number;
    write: (target: number) => Promise<number | null>;
    retry?: (target: number) => Promise<number | null>;
    signal: AbortSignal;
    acceptClamped?: boolean;
    onAttempt?: (attempt: number) => void;
}) => {
    const startedAt = Date.now();
    let attempts = 0;
    let failed = false;
    let lastApplied: number | null = null;
    const finish = (outcome: DeliveryOutcome) => ({
        outcome,
        attempts,
        failed,
        lastApplied,
        elapsedMs: Date.now() - startedAt,
    });
    for (let attempt = 1; attempt <= COMMAND_DELIVERY_LIMIT; attempt++) {
        if (signal.aborted) return finish('cancelled');
        const send = attempt === 1 ? write : retry;
        if (!send) return finish('retry_unavailable');
        if (attempt > 1 && !(await pauseForRetry(signal))) return finish('cancelled');
        if (signal.aborted) return finish('cancelled');
        attempts = attempt;
        onAttempt?.(attempt);
        try {
            lastApplied = await send(target);
        } catch {
            lastApplied = null;
        }
        const confirmed = lastApplied != null && (acceptClamped || lastApplied === target);
        failed ||= !confirmed;
        if (signal.aborted) return finish('cancelled');
        if (confirmed) return finish('recovered');
    }
    return finish('exhausted');
};
