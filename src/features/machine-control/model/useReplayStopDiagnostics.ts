import { logger } from '@shared/lib/logger';
import { useEffect, useRef } from 'react';

/** Observe committed stop transitions; never participate in Replay control decisions. */
export const useReplayStopDiagnostics = ({
    stopReason,
    sessionId,
    elapsed,
    bt,
    firedCount,
    observationQuality,
}: {
    stopReason: string | null;
    sessionId: string | null;
    elapsed: number;
    bt: number | null;
    firedCount: number;
    observationQuality: string | null;
}) => {
    const reportedStop = useRef<string | null>(null);
    useEffect(() => {
        if (reportedStop.current === stopReason) return;
        reportedStop.current = stopReason;
        // writeFailed already follows the request/sidecar reporting and filtering policy.
        if (stopReason !== 'timingGap') return;
        try {
            // Distinct incidents survive SDK dedupe while sharing the same issue fingerprint.
            logger.capture(new Error(`Replay stopped: ${stopReason} (${crypto.randomUUID()})`), {
                tags: { feature: 'machine-control' },
                level: 'warning',
                fingerprint: ['replay-stopped', stopReason],
                extra: { reason: stopReason, sessionId, elapsed, bt, firedCount, observationQuality },
            });
        } catch {
            // Diagnostic failures must not affect stopping or explicit resume.
        }
    }, [stopReason, sessionId, elapsed, bt, firedCount, observationQuality]);
};
