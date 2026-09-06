import { beforeEach, describe, expect, it } from 'vitest';
import { useRoastingStore } from './status';

const virtualSnap = {
    machine_id: '__virtual__',
    machine_name: 'Virtual Machine',
    machine_roaster_key: 'virtual',
    machine_brand: 'Internal',
    machine_protocol: 'virtual',
};

describe('useRoastingStore reset', () => {
    beforeEach(() => {
        useRoastingStore.getState().reset();
        useRoastingStore.setState({
            machineSnapshot: null,
            sidecarConnected: false,
            machineCapabilities: [],
        });
    });

    it('keeps machineRoasterKey through startCharge → reset → enterPreheating()', () => {
        const store = useRoastingStore.getState();
        store.rememberMachineSnapshot(virtualSnap);
        store.enterPreheating(['heater']);
        store.enterStandby();
        store.startCharge();
        store.reset();
        useRoastingStore.getState().enterPreheating();
        expect(useRoastingStore.getState().machineSnapshot?.machine_roaster_key).toBe('virtual');
    });
});
