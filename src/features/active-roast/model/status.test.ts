import { afterEach, describe, expect, it } from 'vitest';
import { reduceSensorObservation, type SensorObservationTick } from '../lib/sensorObservation';
import { useRoastingStore } from './status';

const live = {
    bt: 200,
    et: 210,
    ror: 5,
    ror_et: 4,
    heater: 80,
    fan: 40,
    drum: 60,
};

const tick = (receivedAtMs: number, over: Partial<SensorObservationTick> = {}): SensorObservationTick => ({
    receivedAtMs,
    deviceTimestamp: 10,
    bt: 200,
    stale: false,
    reconnecting: false,
    spikeRejected: false,
    pollError: false,
    ...over,
});

afterEach(() => {
    useRoastingStore.getState().reset();
});

describe('useRoastingStore observation vs display', () => {
    it('keeps liveData identity when only timestamp/stale/receivedAt change', () => {
        useRoastingStore.getState().updateLiveData(live);
        const first = useRoastingStore.getState().liveData;
        useRoastingStore.getState().updateLiveData({
            ...live,
            timestamp: 99,
            receivedAtMs: 1_234,
            stale: true,
        });
        expect(useRoastingStore.getState().liveData).toBe(first);
    });

    it('stores quality independently so display dedupe does not drop it', () => {
        const observation = reduceSensorObservation(null, tick(1_000));
        useRoastingStore.getState().updateLiveData(live);
        const display = useRoastingStore.getState().liveData;
        useRoastingStore.getState().updateSensorObservation(observation);
        expect(useRoastingStore.getState().liveData).toBe(display);
        expect(useRoastingStore.getState().observation).toEqual(observation);

        const stale = reduceSensorObservation(observation, tick(1_400, { deviceTimestamp: 11, stale: true }));
        useRoastingStore.getState().updateSensorObservation(stale);
        expect(useRoastingStore.getState().liveData).toBe(display);
        expect(useRoastingStore.getState().observation?.quality).toBe('stale');
    });

    it('preserves the latest classify time across same-quality ticks', () => {
        const first = reduceSensorObservation(null, tick(1_000));
        useRoastingStore.getState().updateSensorObservation(first);
        const second = reduceSensorObservation(first, tick(1_400));
        useRoastingStore.getState().updateSensorObservation(second);
        const third = reduceSensorObservation(second, tick(1_800));
        useRoastingStore.getState().updateSensorObservation(third);
        expect(useRoastingStore.getState().observation?.quality).toBe('retransmit');
        expect(useRoastingStore.getState().observation?.receivedAtMs).toBe(1_800);
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(1_000);
    });

    it('clears observation on machine change and reset, not on charge', () => {
        const observation = reduceSensorObservation(null, tick(1_000));
        useRoastingStore.getState().updateSensorObservation(observation);
        useRoastingStore.getState().enterPreheating();
        useRoastingStore.getState().enterStandby();
        useRoastingStore.getState().startCharge(1_000);
        expect(useRoastingStore.getState().observation).toEqual(observation);

        useRoastingStore.getState().rememberMachineSnapshot({
            machine_id: 'b',
            machine_name: 'B',
            machine_roaster_key: 'b',
            machine_brand: 'Brand',
            machine_protocol: 'modbus',
        });
        expect(useRoastingStore.getState().observation).toBeNull();
        expect(useRoastingStore.getState().rawTemperature).toBeNull();

        useRoastingStore.getState().updateSensorObservation(observation);
        useRoastingStore.getState().reset();
        expect(useRoastingStore.getState().observation).toBeNull();
    });
});
