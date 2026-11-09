import { describe, expect, it } from 'vitest';
import { buildTypedConnectionParams, initRoasterFormParams, validateRoasterFormFields } from './lib';
import { updatePhidgetParam } from './phidget';
import { ROASTER_REGISTRY } from './roasterRegistry';

const def = ROASTER_REGISTRY.phidget_tmp1101;

describe('Phidget connection settings', () => {
    it('hydrates legacy addresses and preserves explicitly disabled ET through a saved roundtrip', () => {
        const params = initRoasterFormParams(def, { device_type: '1048', serial_number: 1234, channel_et: null });
        expect(params).toMatchObject({
            bt_device_type: '1048',
            et_device_type: '1048',
            bt_serial_number: '1234',
            et_serial_number: '1234',
            channel_et: '',
        });
        expect(initRoasterFormParams(def, { serial_number: 999, bt_serial_number: null }).bt_serial_number).toBe('');
        params.bt_serial_number = '';
        const typed = buildTypedConnectionParams(def, params);
        expect(typed).toMatchObject({ bt_serial_number: null, et_serial_number: 1234, channel_et: null });
        expect(typed).not.toHaveProperty('serial_number');
        expect(initRoasterFormParams(def, typed)).toEqual(params);
    });

    it('serializes independent RTD modules with their probe types and numeric addresses', () => {
        const params = {
            ...initRoasterFormParams(ROASTER_REGISTRY.phidget_tmp1202),
            bt_serial_number: '123',
            bt_hub_port: '0',
            et_device_type: 'TMP1200',
            et_serial_number: '123',
            et_hub_port: '1',
            channel_et: '0',
            bt_rtd_type: 'PT100_3850',
            bt_rtd_wire_setup: '3',
        };
        expect(validateRoasterFormFields(def, params)).toBeNull();
        expect(buildTypedConnectionParams(def, params)).toMatchObject({
            bt_device_type: 'TMP1202',
            bt_serial_number: 123,
            bt_hub_port: 0,
            bt_rtd_type: 'PT100_3850',
            bt_rtd_wire_setup: 3,
            et_device_type: 'TMP1200',
            et_hub_port: 1,
            channel_bt: 0,
            channel_et: 0,
        });
    });

    it.each([
        ['channel_bt', '-1'],
        ['channel_bt', '1.5'],
        ['channel_bt', '4'],
        ['bt_serial_number', '0'],
        ['bt_serial_number', '2147483648'],
        ['bt_hub_port', '6'],
        ['bt_hub_port', '0.5'],
        ['bt_thermocouple_type', 'N'],
        ['bt_device_type', 'other'],
    ])('rejects invalid %s = %s', (key, value) => {
        expect(validateRoasterFormFields(def, { ...initRoasterFormParams(def), [key]: value })).not.toBeNull();
    });

    it.each([
        ['channel_bt', '1'],
        ['bt_rtd_type', 'PT100'],
        ['bt_rtd_wire_setup', '5'],
    ])('rejects invalid RTD %s', (key, value) => {
        expect(
            validateRoasterFormFields(ROASTER_REGISTRY.phidget_tmp1200, {
                ...initRoasterFormParams(ROASTER_REGISTRY.phidget_tmp1200),
                [key]: value,
            }),
        ).not.toBeNull();
    });

    it('normalizes only the changed model channel and preserves independent ET settings and disabled state', () => {
        const params = { ...initRoasterFormParams(def), channel_bt: '3', et_serial_number: '123', et_hub_port: '2' };
        expect(updatePhidgetParam(params, 'bt_device_type', 'TMP1200')).toMatchObject({
            channel_bt: '0',
            channel_et: '1',
            et_device_type: 'TMP1101',
            et_serial_number: '123',
            et_hub_port: '2',
        });
        expect(updatePhidgetParam({ ...params, channel_et: '' }, 'et_device_type', 'TMP1202').channel_et).toBe('');
    });
});
