import { afterEach, describe, expect, it, vi } from 'vitest';
import { reduceSensorObservation, sensorObservationTick } from '../lib/sensorObservation';
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

const sample = (receivedAtMs: number, over: Parameters<typeof sensorObservationTick>[1] = {}) =>
    sensorObservationTick(receivedAtMs, { deviceTimestamp: 10, bt: 200, ...over });

afterEach(() => {
    useRoastingStore.getState().reset();
});

describe('startCharge after Drop (#484)', () => {
    it('clears Charge-wait and heat hold so PID/Replay can run on the next batch only after Charge', () => {
        useRoastingStore.setState({ awaitingNextCharge: true, heatHoldAfterDrop: true });
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().awaitingNextCharge).toBe(false);
        expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(false);
        expect(useRoastingStore.getState().phase).toBe('roasting');
    });

    it('refuses another Charge while roasting or ended, then allows one after reset', () => {
        useRoastingStore.getState().startCharge();
        const first = useRoastingStore.getState().sessionId;
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().sessionId).toBe(first);
        expect(useRoastingStore.getState().phase).toBe('roasting');

        useRoastingStore.getState().endRoast();
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().sessionId).toBe(first);
        expect(useRoastingStore.getState().phase).toBe('ended');

        useRoastingStore.getState().setConnected(false);
        expect(useRoastingStore.getState().phase).toBe('ended');

        useRoastingStore.getState().reset();
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().phase).toBe('roasting');
        expect(useRoastingStore.getState().sessionId).not.toBe(first);
    });
});

describe('tick follows phase (#628)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('updates elapsed from the wall clock while roasting, including after disconnect, and stops after end or reset', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-28T03:00:00.000Z'));
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().phase).toBe('roasting');
        expect(useRoastingStore.getState().elapsed).toBe(0);

        vi.setSystemTime(Date.now() + 2_500);
        useRoastingStore.getState().tick();
        expect(useRoastingStore.getState().elapsed).toBe(2);

        useRoastingStore.getState().setConnected(false);
        vi.setSystemTime(Date.now() + 1_000);
        useRoastingStore.getState().tick();
        expect(useRoastingStore.getState().phase).toBe('roasting');
        expect(useRoastingStore.getState().sidecarConnected).toBe(false);
        expect(useRoastingStore.getState().elapsed).toBe(3);

        const endedElapsed = useRoastingStore.getState().elapsed;
        useRoastingStore.getState().endRoast();
        vi.setSystemTime(Date.now() + 5_000);
        useRoastingStore.getState().tick();
        expect(useRoastingStore.getState().phase).toBe('ended');
        expect(useRoastingStore.getState().elapsed).toBe(endedElapsed);

        useRoastingStore.getState().reset();
        vi.setSystemTime(Date.now() + 4_000);
        useRoastingStore.getState().tick();
        expect(useRoastingStore.getState().phase).toBe('idle');
        expect(useRoastingStore.getState().elapsed).toBe(0);

        useRoastingStore.setState({ phase: 'roasting', roastStartMs: 0, elapsed: 9 });
        vi.setSystemTime(Date.now() + 8_000);
        useRoastingStore.getState().tick();
        expect(useRoastingStore.getState().elapsed).toBe(9);
    });
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
        const observation = reduceSensorObservation(null, sample(1_000));
        useRoastingStore.getState().updateLiveData(live);
        const display = useRoastingStore.getState().liveData;
        useRoastingStore.getState().updateSensorObservation(observation);
        expect(useRoastingStore.getState().liveData).toBe(display);
        expect(useRoastingStore.getState().observation).toEqual(observation);

        const stale = reduceSensorObservation(observation, sample(1_400, { deviceTimestamp: 11, stale: true }));
        useRoastingStore.getState().updateSensorObservation(stale);
        expect(useRoastingStore.getState().liveData).toBe(display);
        expect(useRoastingStore.getState().observation?.quality).toBe('stale');
    });

    it('preserves the latest classify time across same-quality ticks', () => {
        const first = reduceSensorObservation(null, sample(1_000));
        useRoastingStore.getState().updateSensorObservation(first);
        const second = reduceSensorObservation(first, sample(1_400));
        useRoastingStore.getState().updateSensorObservation(second);
        const third = reduceSensorObservation(second, sample(1_800));
        useRoastingStore.getState().updateSensorObservation(third);
        expect(useRoastingStore.getState().observation?.quality).toBe('retransmit');
        expect(useRoastingStore.getState().observation?.receivedAtMs).toBe(1_800);
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(1_000);
    });

    it('clears observation on machine change and reset, not on charge', () => {
        const observation = reduceSensorObservation(null, sample(1_000));
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
