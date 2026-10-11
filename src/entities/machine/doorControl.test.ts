import { describe, expect, it } from 'vitest';
import { machineDoorControl } from './doorControl';

describe('machineDoorControl', () => {
    it('is only the shared W45A / W60A preset', () => {
        expect(machineDoorControl({ roasterKey: 'giesen_w45a_w60a' })).toBe(true);
        expect(machineDoorControl({ roasterKey: 'giesen_standard' })).toBe(false);
        expect(machineDoorControl({ roasterKey: 'giesen_w6a_pro' })).toBe(false);
    });
});
