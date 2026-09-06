import { describe, expect, it } from 'vitest';
import {
    addressDefaultsForProtocol,
    addressFormFieldsForProtocol,
    flattenAddressMaps,
    nestAddressMaps,
} from './addressMap';

const S7_FORM = {
    bt_db: '5',
    bt_offset: '10',
    bt_type: '1',
    bt_div: '2',
    et_db: '6',
    et_offset: '4',
    et_type: '0',
    et_div: '1',
};

const MODBUS_FORM = {
    bt_register: '12',
    bt_func: '4',
    bt_unit_id: '2',
    bt_float: 'true',
    bt_div: '1',
    bt_mode: 'F',
    et_register: '20',
    et_func: '3',
    et_unit_id: '1',
    et_float: 'false',
    et_div: '0',
    et_mode: 'C',
    word_order: 'big',
};

describe('addressMap protocol dispatch', () => {
    it('returns fields/defaults only for modbus and s7', () => {
        expect(addressFormFieldsForProtocol('s7').some((f) => f.key === 'bt_db')).toBe(true);
        expect(addressFormFieldsForProtocol('modbus').some((f) => f.key === 'bt_register')).toBe(true);
        expect(addressFormFieldsForProtocol('phidget')).toEqual([]);
        expect(addressDefaultsForProtocol('kaleido')).toEqual({});
    });
});

describe('nest/flatten roundtrip', () => {
    it('s7 roundtrips through channels, not control_channels', () => {
        const nested = nestAddressMaps('s7', S7_FORM);
        expect(nested).not.toHaveProperty('control_channels');
        expect(nested).toEqual({
            channels: [
                { role: 'BT', db: 5, offset: 10, area: 6, type: 1, div: 2 },
                { role: 'ET', db: 6, offset: 4, area: 6, type: 0, div: 1 },
            ],
        });
        expect(flattenAddressMaps('s7', nested)).toMatchObject(S7_FORM);
    });

    it('s7 omits ET when et_db is empty', () => {
        const nested = nestAddressMaps('s7', { ...S7_FORM, et_db: '' });
        expect(nested.channels).toHaveLength(1);
        expect(flattenAddressMaps('s7', nested).et_db).toBe('');
    });

    it('modbus roundtrips BT/ET registers', () => {
        const nested = nestAddressMaps('modbus', MODBUS_FORM);
        expect(nested).toEqual({
            modbus_registers: {
                BT: { register: 12, func: 4, unit_id: 2, float: true, div: 1, mode: 'F' },
                ET: { register: 20, func: 3, unit_id: 1, float: false, div: 0, mode: 'C' },
            },
            word_order: 'big',
        });
        expect(flattenAddressMaps('modbus', nested)).toMatchObject(MODBUS_FORM);
    });
});
