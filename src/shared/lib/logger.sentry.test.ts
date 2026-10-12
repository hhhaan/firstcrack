import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldSkipSidecarLoggerCapture } from './sentry';
import { SidecarHttpError } from './sidecar';

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), init: vi.fn() };
});

describe('logger sidecar duplicate guard', () => {
    afterEach(() => vi.clearAllMocks());

    it('does not capture when sidecar already reported the failure', async () => {
        const err = new SidecarHttpError('/temperatures', 'network', 'network error', true);
        expect(shouldSkipSidecarLoggerCapture(err)).toBe(true);
        const { logger } = await import('./logger');
        logger.capture(err, { feature: 'sidecar-polling' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
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
