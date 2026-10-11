import { describe, expect, it } from 'vitest';
import { finishDropControlSnapshot } from './active-roast-drop-wiring';

const pid = (state: 'off' | 'running') => ({
    state,
    sv: 200,
    duty: 50,
    pv: 180,
    p: 0,
    i: 0,
    d: 0,
    error: null,
});

const live = (heater: number) => ({ bt: 180, et: 200, ror: 0, ror_et: 0, heater, fan: 0, drum: 0 });

describe('finishDropControlSnapshot', () => {
    it('uses machine pidActive when store PID already reads off', () => {
        const snap = finishDropControlSnapshot(
            { pid: pid('off'), liveData: live(60) },
            { pidActive: true, batchEvents: [{ id: 'e1' }] },
        );
        expect(snap.pidEngaged).toBe(true);
    });

    it('requires batchEvents in wiring object (Drop replay snapshot)', () => {
        const wiring = { pidActive: false, batchEvents: [{ id: 'batch-edit' }] };
        expect(wiring.batchEvents).toHaveLength(1);
        expect(finishDropControlSnapshot({ pid: pid('off'), liveData: live(0) }, wiring).pidEngaged).toBe(false);
    });
});
