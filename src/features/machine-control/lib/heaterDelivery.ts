import { captureHeaterDeliveryResult } from '@shared/lib/sentry';
import { COMMAND_DELIVERY_LIMIT, COMMAND_RETRY_DELAY_MS, deliverCommand } from './commandDelivery';

export const HEATER_DELIVERY_LIMIT = COMMAND_DELIVERY_LIMIT;
export const HEATER_RETRY_DELAY_MS = COMMAND_RETRY_DELAY_MS;

/** One bounded heater delivery; owner cancellation wins over late responses. */
export const deliverHeaterCommand = async ({
    origin = 'replay',
    target,
    write,
    retry,
    signal,
    onAttempt,
    sessionId,
    connectionEpoch,
}: {
    origin?: 'manual' | 'replay';
    target: number;
    write: (target: number) => Promise<number | null>;
    retry?: (target: number) => Promise<number | null>;
    signal: AbortSignal;
    onAttempt: (attempt: number) => void;
    sessionId?: string | null;
    connectionEpoch?: number;
}): Promise<boolean> => {
    // Manual controls accept the machine's clamp; Replay needs its exact planned value.
    const { failed, ...result } = await deliverCommand({
        target,
        write,
        retry,
        signal,
        onAttempt,
        acceptClamped: origin === 'manual',
    });
    if (failed) {
        captureHeaterDeliveryResult({ ...result, origin, target, sessionId, connectionEpoch });
    }
    return result.outcome === 'recovered';
};
