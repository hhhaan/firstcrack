import * as Sentry from '@sentry/react';
import { createTransport } from '@sentry/react';
import { i18n } from '@shared/i18n';
import ko from '@shared/i18n/locales/ko.json';
import { useToastStore } from '@shared/store/toast';
import { afterEach, expect, it, vi } from 'vitest';
import { createGasOffDiagnostics, type GasOffDiagnosticContext } from './gasOffDiagnostics';

afterEach(async () => {
    vi.useRealTimers();
    await Sentry.close();
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
    vi.restoreAllMocks();
});

it('delivers consecutive incidents to the existing Sentry client with a stable issue fingerprint', async () => {
    await i18n.init({ lng: 'ko', resources: { ko: { translation: ko } } });
    const events: Sentry.Event[] = [];
    Sentry.init({
        dsn: 'https://public@errors.ingest.us.sentry.io/4511400857042944',
        transport: (options) => createTransport(options, () => Promise.resolve({ statusCode: 200 })),
        beforeSend: (event) => {
            events.push(event);
            return event;
        },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    for (let batch = 1; batch <= 2; batch++) {
        const diagnostics = createGasOffDiagnostics();
        const context: GasOffDiagnosticContext = {
            sessionId: `batch-${batch}`,
            roaster: 'giesen_w45a_w60a',
            connectionEpoch: 1,
            connected: true,
            reconnecting: false,
            heaterReadable: true,
            elapsed: 570,
            bt: 192,
            receivedAtMs: Date.now(),
            sample: { heater: 19, timestamp: 100 },
        };
        diagnostics.updateContext(context);
        diagnostics.dispatched({ heater: 0 }, { heater: 'replay' });
        diagnostics.applied({ heater: 0 }, { heater: 0 });
        await vi.advanceTimersByTimeAsync(4000);
        diagnostics.updateContext({ ...context, receivedAtMs: Date.now(), sample: { heater: 19, timestamp: 104 } });
        await vi.advanceTimersByTimeAsync(1000);
        diagnostics.reset();
    }
    vi.useRealTimers();
    await Sentry.flush(2000);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.fingerprint)).toEqual([
        ['gas-off-feedback-not-observed', 'nonzero_feedback'],
        ['gas-off-feedback-not-observed', 'nonzero_feedback'],
    ]);
    expect(events.map((event) => event.extra?.sessionId)).toEqual(['batch-1', 'batch-2']);
    expect(events[0].tags).toMatchObject({ feature: 'machine-control' });
    expect(events[0].level).toBe('warning');
    expect(events[0].extra?.samples).toEqual([expect.objectContaining({ heater: 19 })]);
});
