import { i18n } from '@shared/i18n';
import ko from '@shared/i18n/locales/ko.json';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gasOffDiagnosticContext as context } from './controlDiagnostics.fixtures';
import { createGasOffDiagnostics } from './gasOffDiagnostics';

describe('gas-off feedback diagnostics', () => {
    beforeAll(async () => {
        await i18n.init({ lng: 'ko', resources: { ko: { translation: ko } } });
    });
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
        vi.spyOn(logger, 'capture').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const rig = () => {
        const diagnostic = createGasOffDiagnostics();
        const initial = context();
        diagnostic.updateContext(initial);
        diagnostic.dispatched({ heater: 0 }, { heater: 'replay' });
        diagnostic.applied({ heater: 0 }, { heater: 0 });
        const sample = (heater: number | null, timestamp: number, stale = false) => {
            diagnostic.updateContext({
                ...initial,
                receivedAtMs: Date.now(),
                sample: { heater, timestamp, sensor_clock: 'clock-1', stale },
            });
        };
        return { diagnostic, initial, sample };
    };

    it('reports the silent successful-write/nonzero-feedback case once with bounded evidence and an operator notice', () => {
        const h = rig();
        for (let i = 1; i <= 49; i++) {
            vi.advanceTimersByTime(100);
            h.sample(19, 100 + i / 10);
        }
        expect(logger.capture).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(logger.capture).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ message: expect.stringContaining('Gas-off feedback was not observed') }),
            expect.objectContaining({
                tags: { feature: 'machine-control' },
                level: 'warning',
                fingerprint: ['gas-off-feedback-not-observed', 'nonzero_feedback'],
                extra: expect.objectContaining({
                    sessionId: 'batch-1',
                    requested: 0,
                    applied: 0,
                    elapsedAtSend: 570,
                    btAtSend: 192,
                    feedbackBeforeSend: 19,
                    attempts: 1,
                    origins: ['replay'],
                    samples: expect.arrayContaining([expect.objectContaining({ heater: 19, stale: false })]),
                }),
            }),
        );
        const report = vi.mocked(logger.capture).mock.calls[0][1];
        expect(report?.extra).toHaveProperty('samples.length', 20);
        expect(JSON.stringify(report)).not.toContain('sensor_clock');
        expect(useToastStore.getState().toasts[0]?.message).toBe(ko.machines.gasOffUnconfirmed);
        vi.advanceTimersByTime(10000);
        h.sample(19, 120);
        expect(logger.capture).toHaveBeenCalledTimes(1);
    });

    it('accepts the normal two-second feedback delay without a warning', () => {
        const h = rig();
        vi.advanceTimersByTime(2000);
        h.sample(0, 102);
        vi.advanceTimersByTime(10000);
        expect(logger.capture).not.toHaveBeenCalled();
        expect(useToastStore.getState().toasts).toEqual([]);
    });

    it.each(['stale', 'repeated', 'missing'] as const)('does not treat %s zero feedback as confirmation', (kind) => {
        const h = rig();
        vi.advanceTimersByTime(4000);
        h.sample(kind === 'missing' ? null : 0, kind === 'repeated' ? 100 : 104, kind === 'stale');
        vi.advanceTimersByTime(1000);
        expect(logger.capture).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                fingerprint: ['gas-off-feedback-not-observed', 'feedback_unavailable'],
            }),
        );
    });

    it('reports missing polls without blaming a stale held heater value', () => {
        rig();
        vi.advanceTimersByTime(5000);
        expect(logger.capture).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.objectContaining({ reason: 'feedback_unavailable', samples: [] }),
            }),
        );
    });

    it.each([undefined, Number.NaN])('accepts fresh zero after an invalid initial timestamp (%s)', (timestamp) => {
        const diagnostic = createGasOffDiagnostics();
        diagnostic.updateContext({ ...context(), sample: { heater: 19, timestamp } });
        diagnostic.dispatched({ heater: 0 }, { heater: 'manual' });
        diagnostic.applied({ heater: 0 }, { heater: 0 });
        vi.advanceTimersByTime(2000);
        diagnostic.updateContext({ ...context(), sample: { heater: 0, timestamp: 102 } });
        vi.advanceTimersByTime(5000);
        expect(logger.capture).not.toHaveBeenCalled();
    });

    it('does not restart the diagnostic window or repeat reports for zero retries', () => {
        const h = rig();
        for (let i = 1; i <= 7; i++) {
            vi.advanceTimersByTime(1000);
            h.sample(19, 100 + i);
            h.diagnostic.dispatched({ heater: 0 }, { heater: 'safety' });
            h.diagnostic.applied({ heater: 0 }, { heater: 0 });
        }
        expect(logger.capture).toHaveBeenCalledTimes(1);
        expect(logger.capture).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.objectContaining({
                    attempts: 5,
                    origins: ['replay', 'safety', 'safety', 'safety', 'safety'],
                }),
            }),
        );
    });

    it('waits for the transport acknowledgement and requires a new sample after it', () => {
        const diagnostic = createGasOffDiagnostics();
        diagnostic.updateContext(context());
        diagnostic.dispatched({ heater: 0 }, { heater: 'manual' });
        vi.advanceTimersByTime(6000);
        diagnostic.updateContext({ ...context(), sample: { heater: 0, timestamp: 106, sensor_clock: 'clock-1' } });
        expect(logger.capture).not.toHaveBeenCalled();
        diagnostic.applied({ heater: 0 }, { heater: 0 });
        vi.advanceTimersByTime(5000);
        expect(logger.capture).toHaveBeenCalledTimes(1);
    });

    it.each(['session', 'epoch', 'clock', 'disconnect', 'reconnect', 'reset'] as const)(
        'discards old pending diagnostics on %s changes',
        (kind) => {
            const h = rig();
            vi.advanceTimersByTime(1000);
            if (kind === 'reset') h.diagnostic.reset();
            else
                h.diagnostic.updateContext({
                    ...h.initial,
                    sessionId: kind === 'session' ? 'batch-2' : 'batch-1',
                    connectionEpoch: kind === 'epoch' ? 2 : 1,
                    connected: kind !== 'disconnect',
                    reconnecting: kind === 'reconnect',
                    sample: { heater: 19, timestamp: 101, sensor_clock: kind === 'clock' ? 'clock-2' : 'clock-1' },
                });
            h.diagnostic.applied({ heater: 0 }, { heater: 0 });
            vi.advanceTimersByTime(10000);
            expect(logger.capture).not.toHaveBeenCalled();
        },
    );

    it('keeps monitoring across unrelated fan writes but cancels when a new heater command supersedes zero', () => {
        const h = rig();
        h.diagnostic.dispatched({ fan: 40 }, { fan: 'manual' });
        h.diagnostic.applied({ fan: 40 }, { fan: 40 });
        vi.advanceTimersByTime(3000);
        h.sample(19, 103);
        h.diagnostic.dispatched({ heater: 25 }, { heater: 'manual' });
        vi.advanceTimersByTime(5000);
        expect(logger.capture).not.toHaveBeenCalled();
    });

    it('leaves transport failures to their existing reports', () => {
        const h = rig();
        h.diagnostic.failed({ heater: 0 });
        vi.advanceTimersByTime(5000);
        expect(logger.capture).not.toHaveBeenCalled();
    });

    it('reports a mismatched applied response once per zero episode without a feedback warning', () => {
        const diagnostic = createGasOffDiagnostics();
        diagnostic.updateContext(context());
        const mismatch = () => {
            diagnostic.dispatched({ heater: 0 }, { heater: 'replay' });
            diagnostic.applied({ heater: 0 }, { heater: 1 });
        };
        mismatch();
        mismatch();
        vi.advanceTimersByTime(10000);
        expect(logger.capture).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                message: expect.stringContaining('Gas-off applied response differed from zero'),
            }),
            expect.objectContaining({
                level: 'warning',
                fingerprint: ['gas-off-response-mismatch'],
                extra: expect.objectContaining({
                    sessionId: 'batch-1',
                    requested: 0,
                    applied: 1,
                    elapsedAtSend: 570,
                    btAtSend: 192,
                    origins: ['replay'],
                }),
            }),
        );
        expect(useToastStore.getState().toasts).toEqual([]);
        diagnostic.dispatched({ heater: 25 }, { heater: 'manual' });
        mismatch();
        expect(logger.capture).toHaveBeenCalledTimes(2);
        diagnostic.reset();
    });

    it.each(['no-session', 'no-feedback-channel'] as const)('does not arm for %s', (kind) => {
        const diagnostic = createGasOffDiagnostics();
        diagnostic.updateContext({
            ...context(),
            sessionId: kind === 'no-session' ? null : 'batch-1',
            heaterReadable: kind !== 'no-feedback-channel',
        });
        diagnostic.dispatched({ heater: 0 }, { heater: 'manual' });
        diagnostic.applied({ heater: 0 }, { heater: 0 });
        vi.advanceTimersByTime(5000);
        expect(logger.capture).not.toHaveBeenCalled();
    });

    it.each(['no-context', 'no-session', 'no-feedback-channel'] as const)(
        'retains #946 mismatch reporting with %s without starting feedback diagnostics',
        (kind) => {
            const diagnostic = createGasOffDiagnostics();
            const metadata = {
                ...context(),
                sessionId: kind === 'no-session' ? null : 'batch-1',
                heaterReadable: kind !== 'no-feedback-channel',
            };
            for (let attempt = 0; attempt < 3; attempt++) {
                if (kind !== 'no-context') diagnostic.updateContext(metadata);
                diagnostic.dispatched({ heater: 0 }, { heater: 'replay' });
                diagnostic.applied({ heater: 0 }, { heater: 7 });
            }
            vi.advanceTimersByTime(10_000);
            expect(logger.capture).toHaveBeenCalledExactlyOnceWith(
                expect.any(Error),
                expect.objectContaining({
                    fingerprint: ['gas-off-response-mismatch'],
                    extra: expect.objectContaining({ requested: 0, applied: 7, origins: ['replay'] }),
                }),
            );
            expect(useToastStore.getState().toasts).toEqual([]);
        },
    );

    it('ignores an old mismatch after its dispatch context is replaced', () => {
        const diagnostic = createGasOffDiagnostics();
        diagnostic.updateContext(context());
        diagnostic.dispatched({ heater: 0 }, { heater: 'replay' });
        diagnostic.updateContext({ ...context(), connectionEpoch: 2 });
        diagnostic.applied({ heater: 0 }, { heater: 7 });
        expect(logger.capture).not.toHaveBeenCalled();
    });
});
