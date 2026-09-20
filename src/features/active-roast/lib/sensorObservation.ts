/** Control-path sensor quality at the collection boundary. Distinct from display `liveData`. */

export type ObservationQuality = 'valid' | 'stale' | 'retransmit' | 'null' | 'spike' | 'poll_error' | 'reconnecting';

export type SensorObservation = {
    /** Wall-clock when this tick was classified. Not device sample identity. */
    receivedAtMs: number;
    /** Last time a new valid device observation was accepted. */
    lastValidReceivedAtMs: number | null;
    /** Sidecar monotonic timestamp of that valid observation. Never roast elapsed. */
    lastValidDeviceTimestamp: number | null;
    isNew: boolean;
    quality: ObservationQuality;
};

export type SensorObservationTick = {
    receivedAtMs: number;
    /** Sidecar monotonic seconds. Null when the tick has no device timestamp. */
    deviceTimestamp: number | null;
    bt: number | null;
    stale: boolean;
    reconnecting: boolean;
    spikeRejected: boolean;
    pollError: boolean;
};

const keepLastValid = (prev: SensorObservation | null) => ({
    lastValidReceivedAtMs: prev?.lastValidReceivedAtMs ?? null,
    lastValidDeviceTimestamp: prev?.lastValidDeviceTimestamp ?? null,
});

/**
 * Reduce one collection-boundary tick.
 * Invalid / repeated device observations never refresh last-valid time.
 */
export function reduceSensorObservation(
    prev: SensorObservation | null,
    tick: SensorObservationTick,
): SensorObservation {
    const held = {
        receivedAtMs: tick.receivedAtMs,
        isNew: false,
        ...keepLastValid(prev),
    };

    if (tick.pollError) return { ...held, quality: 'poll_error' };
    if (tick.reconnecting) return { ...held, quality: 'reconnecting' };
    if (tick.spikeRejected) return { ...held, quality: 'spike' };
    if (tick.bt == null) return { ...held, quality: 'null' };
    if (tick.stale) return { ...held, quality: 'stale' };

    const lastTs = prev?.lastValidDeviceTimestamp;
    if (tick.deviceTimestamp == null || (lastTs != null && tick.deviceTimestamp <= lastTs)) {
        return { ...held, quality: 'retransmit' };
    }

    return {
        receivedAtMs: tick.receivedAtMs,
        lastValidReceivedAtMs: tick.receivedAtMs,
        lastValidDeviceTimestamp: tick.deviceTimestamp,
        isNew: true,
        quality: 'valid',
    };
}
