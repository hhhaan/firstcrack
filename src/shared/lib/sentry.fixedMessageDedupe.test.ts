import * as Sentry from '@sentry/react';
import { createTransport } from '@sentry/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    captureHeaterDeliveryResult,
    captureSidecarReadinessFailure,
    captureSidecarRequestFailure,
    resetSidecarFailureRateLimitForTests,
} from './sentry';

describe('fixed-message capture fingerprints vs Dedupe integration', () => {
    let sent = 0;

    beforeEach(async () => {
        sent = 0;
        resetSidecarFailureRateLimitForTests();
        await Sentry.close();
        Sentry.init({
            dsn: 'https://public@errors.ingest.us.sentry.io/4511400857042944',
            integrations: (integrations) => integrations,
            transport: (options) =>
                createTransport(options, (request) => {
                    sent += request.body ? 1 : 0;
                    return Promise.resolve({ statusCode: 200 });
                }),
        });
    });

    afterEach(async () => {
        await Sentry.close();
    });

    it('keeps distinct sidecar route/status failures as separate events', async () => {
        captureSidecarRequestFailure({ route: '/temperatures', method: 'GET', status: 'timeout' });
        captureSidecarRequestFailure({ route: '/status', method: 'GET', status: 'timeout' });
        captureSidecarRequestFailure({ route: '/temperatures', method: 'GET', status: 500 });
        await Sentry.flush(2000);
        expect(sent).toBe(3);
    });
    it('preserves distinct readiness outages with the same stable grouping', async () => {
        for (const episode of [1, 2, 3]) {
            captureSidecarReadinessFailure({
                episode,
                attempts: 1,
                elapsedMs: 5000,
                previouslyReady: true,
                status: 'timeout',
                errorType: 'SidecarHttpError',
            });
        }
        await Sentry.flush(2000);
        expect(sent).toBe(3);
    });

    it('keeps distinct failed probe actions without duplicating the same attempt', async () => {
        for (const action of ['fill_open', 'fill_open', 'stirrer_on']) {
            captureSidecarRequestFailure({ route: '/door-probe', method: 'POST', status: 'timeout', action });
        }
        await Sentry.flush(2000);
        expect(sent).toBe(2);
    });

    it('sends every final Replay outcome despite SDK dedupe, including repeated recoveries', async () => {
        const events: Sentry.Event[] = [];
        Sentry.withScope((scope) => {
            scope.addEventProcessor((event) => {
                events.push(event);
                return event;
            });
            for (const outcome of ['recovered', 'recovered', 'exhausted', 'cancelled', 'retry_unavailable'] as const) {
                captureHeaterDeliveryResult({
                    outcome,
                    target: 50,
                    attempts: 3,
                    lastApplied: null,
                    elapsedMs: 1100,
                    sessionId: 'batch-1',
                    connectionEpoch: 4,
                });
            }
        });
        await Sentry.flush(2000);
        expect(sent).toBe(5);
        expect(events).toHaveLength(5);
        expect(new Set(events.map((event) => event.message)).size).toBe(5);
        expect(events[0].fingerprint).toEqual(events[1].fingerprint);
        for (const event of events) {
            expect(event.level).toBe('info');
            expect(event.exception).toBeUndefined();
            expect(event.tags).toMatchObject({ event: 'replay_delivery_result', role: 'heater' });
            expect(event.extra).toMatchObject({
                target: 50,
                attempts: 3,
                last_applied: null,
                elapsed_ms: 1100,
                session_id: 'batch-1',
                connection_epoch: 4,
            });
        }
    });

    it('records consecutive manual recoveries independently of Replay outcomes', async () => {
        const events: Sentry.Event[] = [];
        Sentry.withScope((scope) => {
            scope.addEventProcessor((event) => {
                events.push(event);
                return event;
            });
            for (let command = 0; command < 2; command++) {
                captureHeaterDeliveryResult({
                    origin: 'manual',
                    outcome: 'recovered',
                    target: 50,
                    attempts: 2,
                    lastApplied: 50,
                    elapsedMs: 600,
                    connectionEpoch: 7,
                });
            }
        });
        await Sentry.flush(2000);
        expect(sent).toBe(2);
        expect(events).toHaveLength(2);
        for (const event of events) {
            expect(event.tags).toMatchObject({
                event: 'manual_heater_delivery_result',
                outcome: 'recovered',
                origin: 'manual',
            });
            expect(event.fingerprint).toEqual(['manual-heater-delivery-result', 'recovered']);
            expect(event.extra).toMatchObject({ attempts: 2, last_applied: 50, connection_epoch: 7 });
        }
    });
});
