import * as Sentry from '@sentry/react';
import { createTransport } from '@sentry/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureSidecarRequestFailure, resetSidecarFailureRateLimitForTests } from './sentry';

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
});
