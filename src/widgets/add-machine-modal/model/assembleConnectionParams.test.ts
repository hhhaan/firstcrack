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
});
