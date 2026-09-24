/**
 * Control-path sensor quality at the collection boundary. Distinct from display `liveData`.
 *
 * `deviceTimestamp` is the sidecar read clock (`time.monotonic()`), not a probe-frame id.
 * Stale last-good replies still advance that clock — those ticks are `stale`, not `retransmit`.
 * `retransmit` is same-or-older read clock vs last valid (cached/duplicate poll) or a missing timestamp.
 */

export type ObservationQuality = 'valid' | 'stale' | 'retransmit' | 'null' | 'spike' | 'poll_error' | 'reconnecting';

export type SensorObservation = {
    /** Wall-clock when this tick was classified. Not device sample identity. */
    receivedAtMs: number;
    /** Last time a new valid sidecar read was accepted. Age source for later control gates. */
    lastValidReceivedAtMs: number | null;
    /** Sidecar read-clock of that valid observation. Never roast elapsed. */
    lastValidDeviceTimestamp: number | null;
    /** Meaningful for this classified tick only — sample `lastValidReceivedAtMs` for age. */
    isNew: boolean;
    quality: ObservationQuality;
};

export type SensorObservationTick = {
    receivedAtMs: number;
    /** Sidecar read-clock seconds. Null when the tick has no timestamp. */
    deviceTimestamp: number | null;
    bt: number | null;
    stale: boolean;
    reconnecting: boolean;
    spikeRejected: boolean;
    pollError: boolean;
};

export function sensorObservationTick(
    receivedAtMs: number,
    over: Partial<Omit<SensorObservationTick, 'receivedAtMs'>> = {},
): SensorObservationTick {
    return {
        receivedAtMs,
        deviceTimestamp: over.deviceTimestamp ?? null,
        bt: over.bt ?? null,
        stale: Boolean(over.stale),
        reconnecting: Boolean(over.reconnecting),
        spikeRejected: Boolean(over.spikeRejected),
        pollError: Boolean(over.pollError),
    };
}

const keepLastValid = (prev: SensorObservation | null) => ({
    lastValidReceivedAtMs: prev?.lastValidReceivedAtMs ?? null,
    lastValidDeviceTimestamp: prev?.lastValidDeviceTimestamp ?? null,
});

/**
 * Reduce one collection-boundary tick.
 * Invalid / repeated reads never refresh last-valid time.
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
    // Missing timestamp cannot prove novelty; same-or-older read clock is a cached poll.
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
