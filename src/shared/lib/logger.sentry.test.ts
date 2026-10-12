import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldSkipSidecarLoggerCapture } from './sentry';
import { SidecarHttpError } from './sidecar';

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), captureMessage: vi.fn(), init: vi.fn() };
});

describe('logger sidecar duplicate guard', () => {
    afterEach(() => vi.clearAllMocks());

    it('does not capture unreported 502 SidecarHttpError via logger.error or logger.capture', async () => {
        const err = new SidecarHttpError('/control', 502, 'plc write failed', false);
        expect(shouldSkipSidecarLoggerCapture(err)).toBe(true);
        const { logger } = await import('./logger');
        logger.error(err);
        logger.capture(err, { feature: 'machine-control', action: 'setControl' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('does not capture when sidecar already reported the failure', async () => {
        const err = new SidecarHttpError('/temperatures', 'network', 'network error', true);
        expect(shouldSkipSidecarLoggerCapture(err)).toBe(true);
        const { logger } = await import('./logger');
        logger.capture(err, { feature: 'sidecar-polling' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('skips logger capture for HTTP 400 validation but not 401 (#771-7)', async () => {
        expect(shouldSkipSidecarLoggerCapture(new SidecarHttpError('/connect', 400, 'Serial Port'))).toBe(true);
        expect(shouldSkipSidecarLoggerCapture(new SidecarHttpError('/connect', 401, 'unauthorized'))).toBe(false);
        const { logger } = await import('./logger');
        logger.capture(new SidecarHttpError('/connect', 401, 'unauthorized'), { context: 'machine connect' });
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('promotes feature from logger context to Sentry tags', async () => {
        const { logger } = await import('./logger');
        logger.capture(new Error('control failed'), { feature: 'machine-control', action: 'setControl' });
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [, hint] = vi.mocked(Sentry.captureException).mock.calls[0] as [
            unknown,
            { tags?: Record<string, string>; extra?: Record<string, unknown> },
        ];
        expect(hint.tags).toEqual({ feature: 'machine-control' });
        expect(hint.extra).toEqual({ action: 'setControl' });
    });
});
