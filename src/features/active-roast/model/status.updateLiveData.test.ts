import { afterEach, describe, expect, it } from 'vitest';
import { useRoastingStore } from './status';

const sample = {
    bt: 200,
    et: 180,
    ror: 5,
    ror_et: 4,
    heater: 50,
    fan: 30,
    drum: 40,
};

describe('updateLiveData', () => {
    afterEach(() => useRoastingStore.getState().reset());

    it('sets stale when sidecar last-good values are unchanged', () => {
        useRoastingStore.getState().updateLiveData(sample);
        useRoastingStore.getState().updateLiveData({ ...sample, stale: true });
        expect(useRoastingStore.getState().liveData?.stale).toBe(true);
    });

    it('clears stale when a later sample is fresh', () => {
        useRoastingStore.getState().updateLiveData({ ...sample, stale: true });
        useRoastingStore.getState().updateLiveData({ ...sample, stale: false });
        expect(useRoastingStore.getState().liveData?.stale).toBe(false);
    });
});
