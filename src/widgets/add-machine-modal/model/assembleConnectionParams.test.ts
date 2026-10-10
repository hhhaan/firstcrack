import { buildProtocolRoasterDef, initRoasterFormParams, ROASTER_REGISTRY, writeMapFormFlags } from '@entities/machine';
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

describe('supported model address overrides', () => {
    it('persists only changed Modbus registers and restores them for editing', () => {
        const def = ROASTER_REGISTRY.diedrich_cr;
        const defaults = initRoasterFormParams(def);
        expect(defaults.bt_register).toBe('0');
        expect(defaults.et_register).toBe('4');
        const assembled = assembleConnectionParams(
            def,
            { ...defaults, bt_register: '123', et_register: '' },
            false,
            false,
        );
        expect(assembled.ok).toBe(true);
        if (!assembled.ok) return;
        expect(assembled.typed).toMatchObject({ bt_register: 123 });
        expect(assembled.typed).not.toHaveProperty('et_register');
        expect(initRoasterFormParams(def, assembled.typed).bt_register).toBe('123');
        expect(initRoasterFormParams(def, assembled.typed).et_register).toBe('4');
    });

    it('persists individual S7 fields and rejects invalid addresses', () => {
        const def = ROASTER_REGISTRY.giesen_standard;
        const params = { ...initRoasterFormParams(def), bt_offset: '200', et_db: '4' };
        expect(initRoasterFormParams(def)).toMatchObject({
            bt_db: '3',
            bt_offset: '116',
            et_db: '3',
            et_offset: '112',
        });
        const assembled = assembleConnectionParams(def, params, false, false);
        expect(assembled.ok).toBe(true);
        if (assembled.ok) expect(assembled.typed).toMatchObject({ bt_offset: 200, et_db: 4 });
        expect(assembleConnectionParams(def, { ...params, bt_offset: '-1' }, false, false)).toEqual({
            ok: false,
            invalid: 'BT Offset',
        });
    });
});

describe('custom Modbus address round trip', () => {
    it('preserves imported signed channels through host-only edits and keeps ET deletion', () => {
        const def = buildProtocolRoasterDef('modbus');
        const imported = {
            host: '10.0.0.1',
            mode: 'tcp',
            port: 502,
            modbus_registers: {
                BT: { register: 1000, func: 4, unit_id: 1, float: false, signed: true, div: 1, mode: 'C' },
                ET: { register: 1001, func: 4, unit_id: 1, float: false, signed: true, div: 1, mode: 'C' },
            },
        };
        const params = { ...initRoasterFormParams(def, imported, { includeAddressMap: true }), host: '10.0.0.2' };
        const assembled = assembleConnectionParams(def, params, true, false);
        expect(assembled.ok).toBe(true);
        if (!assembled.ok) return;
        expect(assembled.typed).toMatchObject({
            host: '10.0.0.2',
            modbus_registers: { BT: { signed: true }, ET: { signed: true } },
        });

        const withoutEt = assembleConnectionParams(def, { ...params, et_register: '' }, true, false);
        expect(withoutEt.ok).toBe(true);
        if (withoutEt.ok) expect(withoutEt.typed).toMatchObject({ modbus_registers: { ET: null } });
    });

    it('does not carry a Modbus map into a protocol change', () => {
        const def = buildProtocolRoasterDef('s7');
        const params = initRoasterFormParams(
            def,
            {
                host: '10.0.0.1',
                modbus_registers: { BT: { register: 1000, signed: true } },
            },
            { includeAddressMap: true },
        );
        const assembled = assembleConnectionParams(def, params, true, false);
        expect(assembled.ok).toBe(true);
        if (assembled.ok) expect(assembled.typed).not.toHaveProperty('modbus_registers');
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
});
