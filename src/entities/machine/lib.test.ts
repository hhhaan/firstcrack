import { describe, expect, it } from 'vitest';
import { buildProtocolRoasterDef, buildTypedConnectionParams, isRoasterFieldVisible } from './lib';

describe('isRoasterFieldVisible', () => {
    it.each(['rtu', 'ascii', 'serial'])('serial mode %s hides TCP fields, shows serial fields', (mode) => {
        expect(isRoasterFieldVisible('host', mode)).toBe(false);
        expect(isRoasterFieldVisible('port', mode)).toBe(false);
        expect(isRoasterFieldVisible('comport', mode)).toBe(true);
        expect(isRoasterFieldVisible('baudrate', mode)).toBe(true);
    });

    it.each(['tcp', 'udp'])('network mode %s hides serial fields, shows TCP fields', (mode) => {
        expect(isRoasterFieldVisible('host', mode)).toBe(true);
        expect(isRoasterFieldVisible('comport', mode)).toBe(false);
        expect(isRoasterFieldVisible('baudrate', mode)).toBe(false);
    });

    it('unknown/empty mode shows everything', () => {
        expect(isRoasterFieldVisible('host', undefined)).toBe(true);
        expect(isRoasterFieldVisible('comport', '')).toBe(true);
    });
});

describe('buildTypedConnectionParams write map', () => {
    it('merges heater read channels onto BT/ET channels', () => {
        const def = buildProtocolRoasterDef('s7');
        const typed = buildTypedConnectionParams(
            def,
            {
                host: '192.168.1.10',
                bt_db: '3',
                bt_offset: '118',
                bt_type: '0',
                bt_div: '0',
                et_db: '',
                heater_w_db: '2',
                heater_w_offset: '14',
                heater_w_type: '0',
                heater_w_div: '0',
                heater_w_min: '0',
                heater_w_max: '100',
                heater_r_db: '2',
                heater_r_offset: '48',
                heater_r_type: '0',
                heater_r_div: '0',
                pid_kp: '20',
                pid_ki: '0.01',
                pid_kd: '3',
            },
            { includeAddressMap: true, includeWriteMap: true },
        );
        const channels = typed.channels as { role: string }[];
        expect(channels.map((c) => c.role)).toEqual(['BT', 'heater']);
        expect(typed.write_map).toEqual({
            heater: { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 0, max: 100, unit: '%' },
        });
        expect(typed.pid).toEqual({ Kp: 20, Ki: 0.01, Kd: 3 });
        expect(typed).not.toHaveProperty('control_channels');
    });
});
