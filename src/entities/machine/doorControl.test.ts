import { describe, expect, it } from 'vitest';
import { machineDoorControl, matchedDoorMachine } from './doorControl';

describe('machineDoorControl', () => {
    it('is only the shared W45A / W60A preset', () => {
        expect(machineDoorControl({ roasterKey: 'giesen_w45a_w60a' })).toBe(true);
        expect(machineDoorControl({ roasterKey: 'giesen_standard' })).toBe(false);
        expect(machineDoorControl({ roasterKey: 'giesen_w6a_pro' })).toBe(false);
    });
});

describe('matchedDoorMachine', () => {
    const w60 = { id: 'w60', roasterKey: 'giesen_w45a_w60a' };
    const other = { id: 'other', roasterKey: 'giesen_w6a_pro' };

    it('uses the connected door machine, or the only saved one when nothing is connected', () => {
        expect(matchedDoorMachine([other, w60], 'w60')).toBe(w60);
        expect(matchedDoorMachine([other, w60], 'other')).toBeUndefined();
        expect(matchedDoorMachine([other, w60], undefined)).toBeUndefined();
        expect(matchedDoorMachine([w60, { ...w60, id: 'w60-b' }], 'w60-b')).toEqual({ ...w60, id: 'w60-b' });
        expect(matchedDoorMachine([w60, { ...w60, id: 'w60-b' }], undefined)).toBeUndefined();
        expect(matchedDoorMachine([w60], 'missing')).toBeUndefined();
    });
});
