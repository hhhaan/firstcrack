import { buildProtocolRoasterDef, ROASTER_REGISTRY, writeMapFormFlags } from '@entities/machine';
import { describe, expect, it } from 'vitest';
import { assembleConnectionParams, persistConnectionParams } from './assembleConnectionParams';

describe('persistConnectionParams', () => {
    it('strips write_map when includeWriteMap is false', () => {
        expect(persistConnectionParams({ host: '10.0.0.1', write_map: { heater: { db: 2 } } }, false)).toEqual({
            host: '10.0.0.1',
        });
    });

    it('keeps write_map when includeWriteMap is true', () => {
        const typed = { host: '10.0.0.1', write_map: { heater: { db: 2 } } };
        expect(persistConnectionParams(typed, true)).toEqual(typed);
    });
});

describe('assembleConnectionParams write-map gate', () => {
    it('known machine never persists write_map (includeWriteMap === showWriteMap === false)', () => {
        const def = ROASTER_REGISTRY.giesen_standard;
        const flags = writeMapFormFlags({
            isCustom: false,
            protocol: def.protocol,
            canConfigureControl: true,
        });
        expect(flags.includeWriteMap).toBe(flags.showWriteMap);
        expect(flags.includeWriteMap).toBe(false);
        const assembled = assembleConnectionParams(
            def,
            { host: '172.30.30.50', port: '102', rack: '0', slot: '0' },
            false,
            flags.includeWriteMap,
        );
        expect(assembled.ok).toBe(true);
        if (assembled.ok) expect(assembled.typed).not.toHaveProperty('write_map');
    });

    it('custom s7 without plan flag does not persist write_map', () => {
        const flags = writeMapFormFlags({ isCustom: true, protocol: 's7', canConfigureControl: false });
        expect(flags.includeWriteMap).toBe(flags.showWriteMap);
        expect(flags.includeWriteMap).toBe(false);
        const def = buildProtocolRoasterDef('s7');
        const assembled = assembleConnectionParams(def, { host: '10.0.0.1' }, false, flags.includeWriteMap);
        expect(assembled.ok).toBe(true);
        if (assembled.ok) {
            expect(assembled.typed).not.toHaveProperty('write_map');
            expect(
                persistConnectionParams(
                    { ...assembled.typed, write_map: { heater: { db: 2 } } },
                    flags.includeWriteMap,
                ),
            ).not.toHaveProperty('write_map');
        }
    });

    it('custom s7 with plan flag keeps write_map on persist', () => {
        const flags = writeMapFormFlags({ isCustom: true, protocol: 's7', canConfigureControl: true });
        expect(flags.includeWriteMap).toBe(flags.showWriteMap);
        expect(flags.includeWriteMap).toBe(true);
        expect(
            persistConnectionParams({ host: '10.0.0.1', write_map: { heater: { db: 2 } } }, flags.includeWriteMap),
        ).toEqual({ host: '10.0.0.1', write_map: { heater: { db: 2 } } });
    });

    it('nests heater write_map and pid from form when includeWriteMap is true', () => {
        const def = buildProtocolRoasterDef('s7');
        const assembled = assembleConnectionParams(
            def,
            {
                host: '10.0.0.1',
                heater_w_db: '2',
                heater_w_offset: '14',
                heater_w_type: '0',
                heater_w_div: '0',
                heater_w_min: '0',
                heater_w_max: '100',
                pid_kp: '20',
                pid_ki: '0.01',
                pid_kd: '3',
            },
            false,
            true,
        );
        expect(assembled.ok).toBe(true);
        if (!assembled.ok) return;
        expect(assembled.typed.write_map).toEqual({
            heater: { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 0, max: 100, unit: '%' },
        });
        expect(assembled.typed.pid).toEqual({ Kp: 20, Ki: 0.01, Kd: 3 });
    });

    it('does not nest write_map from form when includeWriteMap is false', () => {
        const def = buildProtocolRoasterDef('s7');
        const assembled = assembleConnectionParams(
            def,
            {
                host: '10.0.0.1',
                heater_w_db: '2',
                heater_w_offset: '14',
                heater_w_type: '0',
                heater_w_div: '0',
                heater_w_min: '0',
                heater_w_max: '100',
            },
            false,
            false,
        );
        expect(assembled.ok).toBe(true);
        if (assembled.ok) expect(assembled.typed).not.toHaveProperty('write_map');
    });
});
