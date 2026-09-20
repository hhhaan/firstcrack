import { describe, expect, it } from 'vitest';
import {
    reduceSensorObservation,
    type SensorObservation,
    type SensorObservationTick,
    sensorObservationTick,
} from './sensorObservation';

const sample = (receivedAtMs: number, over: Partial<SensorObservationTick> = {}) =>
    sensorObservationTick(receivedAtMs, { deviceTimestamp: 10, bt: 200, ...over });

const valid = (prev: SensorObservation | null, receivedAtMs: number, deviceTimestamp: number, bt = 200) =>
    reduceSensorObservation(prev, sample(receivedAtMs, { deviceTimestamp, bt }));

describe('reduceSensorObservation', () => {
    it('treats a flat BT with a newer device timestamp as a new valid observation', () => {
        const first = valid(null, 1_000, 10, 200);
        const second = valid(first, 1_500, 10.5, 200);

        expect(first).toMatchObject({
            quality: 'valid',
            isNew: true,
            lastValidReceivedAtMs: 1_000,
            lastValidDeviceTimestamp: 10,
        });
        expect(second.quality).toBe('valid');
        expect(second.isNew).toBe(true);
        expect(second.lastValidReceivedAtMs).toBe(1_500);
        expect(second.lastValidDeviceTimestamp).toBe(10.5);
        expect(second.receivedAtMs).toBe(1_500);
    });

    it('does not use receive wall-clock or roast elapsed as device observation identity', () => {
        const first = valid(null, 1_000, 10);
        const retransmit = reduceSensorObservation(first, sample(9_000));

        expect(retransmit.quality).toBe('retransmit');
        expect(retransmit.isNew).toBe(false);
        expect(retransmit.lastValidReceivedAtMs).toBe(1_000);
        expect(retransmit.lastValidDeviceTimestamp).toBe(10);
    });

    it('keeps last-valid time when only stale changes', () => {
        const first = valid(null, 1_000, 10, 200);
        const stale = reduceSensorObservation(first, sample(1_400, { deviceTimestamp: 11, stale: true }));

        expect(stale.quality).toBe('stale');
        expect(stale.isNew).toBe(false);
        expect(stale.lastValidReceivedAtMs).toBe(1_000);
        expect(stale.lastValidDeviceTimestamp).toBe(10);
    });

    it.each([
        ['null', { bt: null as number | null, deviceTimestamp: 12 }],
        ['spike', { spikeRejected: true, deviceTimestamp: 12, bt: 50 }],
        ['poll_error', { pollError: true, bt: null as number | null, deviceTimestamp: null }],
        ['reconnecting', { reconnecting: true, deviceTimestamp: 12 }],
        ['retransmit', { deviceTimestamp: 10 }],
    ] as const)('%s does not refresh last-valid time', (quality, over) => {
        const first = valid(null, 1_000, 10);
        const next = reduceSensorObservation(first, sample(2_000, over));

        expect(next.quality).toBe(quality);
        expect(next.isNew).toBe(false);
        expect(next.lastValidReceivedAtMs).toBe(1_000);
        expect(next.lastValidDeviceTimestamp).toBe(10);
    });

    it('does not inherit last-valid state after a cleared generation', () => {
        const first = valid(null, 1_000, 10, 190);
        const afterClear = valid(null, 5_000, 10, 190);

        expect(first.lastValidReceivedAtMs).toBe(1_000);
        expect(afterClear.lastValidReceivedAtMs).toBe(5_000);
        expect(afterClear.isNew).toBe(true);
        expect(afterClear.quality).toBe('valid');
    });
});
