import * as Sentry from '@sentry/react';
import { i18n } from '@shared/i18n';
import ko from '@shared/i18n/locales/ko.json';
import { buildSentryOptions } from '@shared/lib/sentry';
import { useToastStore } from '@shared/store/toast';
import { afterEach, expect, it, vi } from 'vitest';
import { createSentryMemoryTransport, gasOffDiagnosticContext } from './controlDiagnostics.fixtures';
import { createGasOffDiagnostics } from './gasOffDiagnostics';

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
        ...buildSentryOptions(),
        transport: () => createSentryMemoryTransport(events),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    for (let batch = 1; batch <= 2; batch++) {
        const diagnostics = createGasOffDiagnostics();
        const context = gasOffDiagnosticContext(`batch-${batch}`);
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

it('delivers separate response mismatches through SDK dedupe with a stable fingerprint', async () => {
    const events: Sentry.Event[] = [];
    Sentry.init({
        ...buildSentryOptions(),
        transport: () => createSentryMemoryTransport(events),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let batch = 1; batch <= 2; batch++) {
        const diagnostic = createGasOffDiagnostics();
        diagnostic.updateContext(gasOffDiagnosticContext(`batch-${batch}`));
        for (let retry = 0; retry < 3; retry++) {
            diagnostic.dispatched({ heater: 0 }, { heater: 'replay' });
            diagnostic.applied({ heater: 0 }, { heater: 7 });
        }
        diagnostic.reset();
    }
    await Sentry.flush(2000);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.fingerprint)).toEqual([
        ['gas-off-response-mismatch'],
        ['gas-off-response-mismatch'],
    ]);
    expect(events.map((event) => event.extra?.sessionId)).toEqual(['batch-1', 'batch-2']);
    expect(events[0].extra).toMatchObject({ requested: 0, applied: 7 });
    expect(events[0].level).toBe('warning');
});
