import { describe, expect, it } from 'vitest';
import { presetHeaterOnly, presetReadonlyDrumFan } from './control-preset-test-fixtures';
import { readableRolesFromParams, resolveSupportedControlChannels } from './supported-control-channels';

describe('readableRolesFromParams', () => {
    it('reads S7 channel roles', () => {
        expect(
            readableRolesFromParams({
                channels: [{ role: 'BT' }, { role: 'fan' }, { role: 'drum' }],
            }).sort(),
        ).toEqual(['drum', 'fan']);
    });

    it('reads modbus register keys', () => {
        expect(
            readableRolesFromParams({
                modbus_registers: { BT: {}, heater: {}, fan: {} },
            }).sort(),
        ).toEqual(['fan', 'heater']);
    });
});

describe('resolveSupportedControlChannels', () => {
    it('includes Bühler drum/fan from preset readable_controls without write capabilities', () => {
        expect(presetReadonlyDrumFan).toBeDefined();
        const supported = resolveSupportedControlChannels({
            roasterKey: presetReadonlyDrumFan,
            capabilities: [],
        });
        expect(supported).toEqual({ drum: true, heat: false, fan: true });
    });

    it('excludes fan/drum on heater-only Loring presets', () => {
        expect(presetHeaterOnly).toBeDefined();
        const supported = resolveSupportedControlChannels({
            roasterKey: presetHeaterOnly,
            capabilities: ['heater'],
        });
        expect(supported).toEqual({ drum: false, heat: true, fan: false });
    });

    it('merges custom connection params over an empty preset map', () => {
        const supported = resolveSupportedControlChannels({
            roasterKey: 'custom_modbus',
            connectionParams: { modbus_registers: { heater: {}, fan: {} } },
            capabilities: [],
        });
        expect(supported.fan).toBe(true);
        expect(supported.heat).toBe(true);
    });
});
