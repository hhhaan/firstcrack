import { describe, expect, it } from 'vitest';
import {
    controlCapabilitiesFromParams,
    flattenWriteMaps,
    nestWriteMaps,
    pidFromParams,
    validateWriteMaps,
} from './writeMap';

const heaterWrite = {
    heater_w_db: '2',
    heater_w_offset: '14',
    heater_w_type: '0',
    heater_w_div: '0',
    heater_w_min: '0',
    heater_w_max: '100',
};

describe('nestWriteMaps', () => {
    it('returns empty when no control fields are filled', () => {
        expect(nestWriteMaps('s7', {})).toEqual({});
    });

    it('nests heater write_map and PID', () => {
        const out = nestWriteMaps('s7', {
            ...heaterWrite,
            pid_kp: '20',
            pid_ki: '0.01',
            pid_kd: '3',
        });
        expect(out.write_map).toEqual({
            heater: { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 0, max: 100, unit: '%' },
        });
        expect(out.pid).toEqual({ Kp: 20, Ki: 0.01, Kd: 3 });
        expect(out.control_channels).toBeUndefined();
    });

    it('nests heater/fan/drum read channels separately from BT/ET', () => {
        const out = nestWriteMaps('s7', {
            heater_r_db: '2',
            heater_r_offset: '48',
            heater_r_type: '0',
            heater_r_div: '0',
            fan_r_db: '2',
            fan_r_offset: '10',
            fan_r_type: '0',
            fan_r_div: '0',
        });
        expect(out.control_channels).toEqual([
            { role: 'heater', db: 2, offset: 48, area: 6, type: 0, div: 0 },
            { role: 'fan', db: 2, offset: 10, area: 6, type: 0, div: 0 },
        ]);
    });

    it('ignores non-s7 protocols', () => {
        expect(nestWriteMaps('modbus', heaterWrite)).toEqual({});
    });
});

describe('flattenWriteMaps', () => {
    it('round-trips write_map, pid, and control channels', () => {
        const nested = nestWriteMaps('s7', {
            ...heaterWrite,
            heater_r_db: '2',
            heater_r_offset: '48',
            heater_r_type: '0',
            heater_r_div: '0',
            pid_kp: '20',
            pid_ki: '0.01',
            pid_kd: '3',
        });
        const flat = flattenWriteMaps('s7', {
            write_map: nested.write_map,
            pid: nested.pid,
            channels: nested.control_channels,
        });
        expect(flat.heater_w_db).toBe('2');
        expect(flat.heater_w_offset).toBe('14');
        expect(flat.heater_r_db).toBe('2');
        expect(flat.heater_r_offset).toBe('48');
        expect(flat.pid_kp).toBe('20');
        expect(flat.pid_ki).toBe('0.01');
        expect(flat.pid_kd).toBe('3');
    });
});

describe('validateWriteMaps', () => {
    it('requires write offset when write DB is set', () => {
        expect(validateWriteMaps('s7', { heater_w_db: '2', heater_w_offset: '' })).toBe('Heater write offset');
    });

    it('requires all PID fields when any is set', () => {
        expect(validateWriteMaps('s7', { pid_kp: '20' })).toBe('PID Ki');
    });

    it('passes when all optional', () => {
        expect(validateWriteMaps('s7', {})).toBeNull();
    });
});

describe('pidFromParams / controlCapabilitiesFromParams', () => {
    it('reads pid object', () => {
        expect(pidFromParams({ pid: { Kp: 4, Ki: 0.3, Kd: 2 } })).toEqual({ Kp: 4, Ki: 0.3, Kd: 2 });
        expect(pidFromParams({})).toBeNull();
    });

    it('unions write_map keys and control channel roles', () => {
        expect(
            controlCapabilitiesFromParams({
                write_map: { heater: { db: 2 } },
                channels: [{ role: 'BT' }, { role: 'fan', db: 2, offset: 10 }],
            }),
        ).toEqual(['heater', 'fan']);
    });
});
