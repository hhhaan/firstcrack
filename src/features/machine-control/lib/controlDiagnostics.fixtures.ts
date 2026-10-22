import type { createTransport, Event } from '@sentry/react';
import type { GasOffDiagnosticContext } from './gasOffDiagnostics';

export const gasOffDiagnosticContext = (sessionId = 'batch-1'): GasOffDiagnosticContext => ({
    sessionId,
    roaster: 'giesen_w45a_w60a',
    connectionEpoch: 1,
    connected: true,
    reconnecting: false,
    heaterReadable: true,
    elapsed: 570,
    bt: 192,
    receivedAtMs: Date.now(),
    sample: { heater: 19, timestamp: 100, sensor_clock: 'clock-1', stale: false },
});

export const createSentryMemoryTransport = (events: Event[]): ReturnType<typeof createTransport> => ({
    send: async (envelope) => {
        for (const [header, payload] of envelope[1]) {
            if (header.type === 'event') events.push(payload as Event);
        }
        return { statusCode: 200 };
    },
    flush: async () => true,
});
