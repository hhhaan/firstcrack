import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import type { TemperatureReading } from '@shared/types/sidecar';
import type { ControlOrigin, ControlSendObserver } from './controlSender';

// Diagnostic window only: feedback lag must never stop Replay or resend a command.
const FEEDBACK_WINDOW_MS = 5000;
const MAX_SAMPLES = 20;

export interface GasOffDiagnosticContext {
    sessionId: string | null;
    roaster: string | null;
    connectionEpoch: number | null;
    connected: boolean;
    reconnecting: boolean;
    heaterReadable: boolean;
    elapsed: number;
    bt: number | null;
    receivedAtMs: number | null;
    sample:
        | (Pick<TemperatureReading, 'heater' | 'sensor_clock' | 'stale'> &
              Partial<Pick<TemperatureReading, 'timestamp'>>)
        | null;
}

type FeedbackSample = {
    afterSendMs: number;
    heater: number | null;
    timestamp: number | null;
    stale: boolean;
};

type GasOffWatch = {
    commandId: string;
    sequence: number;
    sentAtMs: number;
    context: GasOffDiagnosticContext;
    attempts: number;
    origins: ControlOrigin[];
    samples: FeedbackSample[];
    lastReceivedAtMs: number | null;
    lastTimestamp: number | null;
    acknowledgement: { state: 'pending' } | { state: 'applied'; atMs: number };
    reported: boolean;
};

/** One bounded incident per zero command episode; successful transport is not heat feedback. */
export const createGasOffDiagnostics = () => {
    let context: GasOffDiagnosticContext | null = null;
    let watch: GasOffWatch | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    let responseMismatchReported = false;

    const clearWatch = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        watch = null;
    };

    const reset = () => {
        clearWatch();
        responseMismatchReported = false;
    };

    const report = () => {
        timer = undefined;
        if (!watch || !context || watch.reported || watch.acknowledgement.state !== 'applied') return;
        watch.reported = true;
        const last = watch.samples[watch.samples.length - 1];
        const feedbackAvailable =
            watch.samples.length > 0 &&
            !last.stale &&
            last.heater != null &&
            last.heater > 0 &&
            watch.lastReceivedAtMs != null &&
            watch.lastReceivedAtMs > watch.acknowledgement.atMs &&
            Date.now() - watch.lastReceivedAtMs < FEEDBACK_WINDOW_MS;
        const reason = feedbackAvailable ? 'nonzero_feedback' : 'feedback_unavailable';
        useToastStore.getState().show(i18n.t('machines.gasOffUnconfirmed'), 'error');
        // Keep distinct incidents through SDK dedupe; the fixed fingerprint groups them server-side.
        logger.capture(new Error(`Gas-off feedback was not observed (${watch.commandId})`), {
            tags: { feature: 'machine-control' },
            level: 'warning',
            fingerprint: ['gas-off-feedback-not-observed', reason],
            extra: {
                reason,
                sessionId: watch.context.sessionId,
                roaster: watch.context.roaster,
                connectionEpoch: watch.context.connectionEpoch,
                commandSequence: watch.sequence,
                commandId: watch.commandId,
                requested: 0,
                applied: 0,
                attempts: watch.attempts,
                origins: [...watch.origins],
                elapsedAtSend: watch.context.elapsed,
                btAtSend: watch.context.bt,
                feedbackBeforeSend: watch.context.sample?.heater ?? null,
                acknowledgementMs: watch.acknowledgement.atMs - watch.sentAtMs,
                observationWindowMs: Date.now() - watch.acknowledgement.atMs,
                samples: [...watch.samples],
            },
        });
    };

    const observer: ControlSendObserver = {
        dispatched(command, origins) {
            if (command.heater === undefined) return;
            sequence += 1;
            if (
                command.heater !== 0 ||
                !context?.sessionId ||
                !context.connected ||
                context.reconnecting ||
                !context.heaterReadable
            ) {
                reset();
                return;
            }
            if (!watch) {
                const timestamp = context.sample?.timestamp;
                watch = {
                    commandId: crypto.randomUUID(),
                    sequence,
                    sentAtMs: Date.now(),
                    context,
                    attempts: 0,
                    origins: [],
                    samples: [],
                    lastReceivedAtMs: null,
                    lastTimestamp: timestamp != null && Number.isFinite(timestamp) ? timestamp : null,
                    acknowledgement: { state: 'pending' },
                    reported: false,
                };
            }
            watch.attempts += 1;
            if (watch.origins.length < MAX_SAMPLES) watch.origins.push(origins.heater ?? 'manual');
        },
        applied(requested, applied) {
            if (requested.heater !== 0 || !watch) return;
            if (applied.heater !== 0) {
                const incident = watch;
                clearWatch();
                if (responseMismatchReported) return;
                responseMismatchReported = true;
                try {
                    logger.capture(new Error(`Gas-off applied response differed from zero (${incident.commandId})`), {
                        tags: { feature: 'machine-control' },
                        level: 'warning',
                        fingerprint: ['gas-off-response-mismatch'],
                        extra: {
                            sessionId: incident.context.sessionId,
                            roaster: incident.context.roaster,
                            connectionEpoch: incident.context.connectionEpoch,
                            commandId: incident.commandId,
                            requested: 0,
                            applied: applied.heater ?? null,
                            elapsedAtSend: incident.context.elapsed,
                            btAtSend: incident.context.bt,
                            origins: [...incident.origins],
                        },
                    });
                } catch {
                    // Observation only: preserve the applied response and existing Replay policy.
                }
                return;
            }
            if (watch.acknowledgement.state === 'pending') {
                watch.acknowledgement = { state: 'applied', atMs: Date.now() };
                const timestamp = context?.sample?.timestamp;
                if (timestamp != null && Number.isFinite(timestamp)) watch.lastTimestamp = timestamp;
                timer = setTimeout(report, FEEDBACK_WINDOW_MS);
            }
        },
        failed(requested) {
            // Transport failures are already captured by the existing control error path.
            if (requested.heater !== undefined) reset();
        },
    };

    return {
        ...observer,
        reset,
        updateContext(next: GasOffDiagnosticContext) {
            if (
                !context ||
                context.sessionId !== next.sessionId ||
                context.roaster !== next.roaster ||
                context.connectionEpoch !== next.connectionEpoch ||
                (context.sample?.sensor_clock != null &&
                    next.sample?.sensor_clock != null &&
                    context.sample.sensor_clock !== next.sample.sensor_clock) ||
                !next.connected ||
                !next.heaterReadable ||
                next.reconnecting
            )
                reset();
            context = next;
            if (!watch || !next.sample || next.receivedAtMs == null) return;
            const sample = next.sample;
            if (next.receivedAtMs <= Math.max(watch.sentAtMs, watch.lastReceivedAtMs ?? 0)) return;
            const fresh =
                !sample.stale &&
                sample.timestamp != null &&
                Number.isFinite(sample.timestamp) &&
                sample.timestamp > (watch.lastTimestamp ?? Number.NEGATIVE_INFINITY);
            const heater = sample.heater != null && Number.isFinite(sample.heater) ? sample.heater : null;
            watch.lastReceivedAtMs = next.receivedAtMs;
            if (fresh) watch.lastTimestamp = sample.timestamp ?? null;
            watch.samples.push({
                afterSendMs: next.receivedAtMs - watch.sentAtMs,
                heater,
                timestamp: sample.timestamp ?? null,
                stale: !fresh,
            });
            if (watch.samples.length > MAX_SAMPLES) watch.samples.shift();
            if (
                fresh &&
                heater === 0 &&
                watch.acknowledgement.state === 'applied' &&
                next.receivedAtMs > watch.acknowledgement.atMs
            )
                reset();
        },
    };
};
