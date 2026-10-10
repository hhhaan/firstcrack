import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import { describe, expect, it } from 'vitest';
import { flattenAddressMaps, nestAddressMaps } from './addressMap';
import { mapArtisanMachine } from './artisan';

const snapshot = (settings: Record<string, unknown>, version: string | null = null): ArtisanSettingsSnapshot => ({
    status: 'found',
    source: { product: 'Artisan', version, sourceId: 'native' },
    settings,
});

describe('mapArtisanMachine', () => {
    it('requires version confirmation before restoring omitted Artisan defaults', () => {
        const source = snapshot({
            'Device/id': 29,
            'Modbus/input1deviceId': 1,
            'Modbus/input1register': 1000,
        });
        expect(mapArtisanMachine(source, null)).toMatchObject({
            draft: null,
            issues: [{ field: 'source/version', code: 'needs-version' }],
        });
        expect(mapArtisanMachine(source, '4.2.0').draft?.connectionParams).toMatchObject({
            mode: 'rtu',
            baudrate: 115200,
            modbus_registers: {
                BT: { register: 1000, func: 3, unit_id: 1, signed: false, div: 0, mode: 'C' },
                ET: null,
            },
        });
        expect(mapArtisanMachine(snapshot(source.settings ?? {}, '4.9.0'), null).issues).toContainEqual({
            field: 'source/version',
            code: 'needs-version',
        });
        expect(mapArtisanMachine(snapshot(source.settings ?? {}, '4.9.0'), '4.2.0').draft).toBeNull();
    });

    it('requires active BT and ignores stale settings on disabled ET', () => {
        expect(mapArtisanMachine(snapshot({ 'Device/id': 29 }), '4.2.0')).toMatchObject({
            draft: null,
            issues: [{ field: 'Modbus/input1deviceId', code: 'missing' }],
        });
        const mapped = mapArtisanMachine(
            snapshot({
                'Device/id': 29,
                'Modbus/input1deviceId': 1,
                'Modbus/input2deviceId': 0,
                'Modbus/input2register': 999999,
                'Modbus/input2float': true,
                'Modbus/input2mode': 'K',
            }),
            '4.2.0',
        );
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft?.connectionParams).toMatchObject({ modbus_registers: { BT: {}, ET: null } });
    });

    it('maps explicit TCP channels, preserving zero and false values and F units', () => {
        const mapped = mapArtisanMachine(
            snapshot(
                {
                    'Device/id': 29,
                    'Modbus/type': 3,
                    'Modbus/host': '192.0.2.4',
                    'Modbus/port': 502,
                    'Modbus/input1deviceId': 1,
                    'Modbus/input1register': 0,
                    'Modbus/input1code': 4,
                    'Modbus/input1div': 0,
                    'Modbus/input1mode': 'F',
                    'Modbus/input1Signed': false,
                    'Modbus/input2deviceId': 2,
                    'Modbus/input2register': 1001,
                    'Modbus/input2code': 3,
                    'Modbus/input2div': 1,
                    'Modbus/input2mode': 'C',
                },
                '4.2.0',
            ),
            null,
        );
        expect(mapped.draft).toMatchObject({
            protocol: 'modbus',
            importSource: { product: 'Artisan', sourceId: 'native' },
            connectionParams: {
                mode: 'tcp',
                host: '192.0.2.4',
                port: 502,
                modbus_registers: {
                    BT: { register: 0, func: 4, unit_id: 1, div: 0, mode: 'F', float: false, signed: false },
                    ET: { register: 1001, func: 3, unit_id: 2, div: 1, mode: 'C' },
                },
            },
        });
        const params = mapped.draft?.connectionParams ?? {};
        expect(nestAddressMaps('modbus', flattenAddressMaps('modbus', params))).toEqual({
            modbus_registers: params.modbus_registers,
            word_order: 'little',
        });
    });

    it.each([
        [{ 'Device/id': 1 }, 'Device/id', 'unsupported-device'],
        [{ 'Device/id': 29, 'Modbus/type': 2 }, 'Modbus/type', 'unsupported-transport'],
        [
            { 'Device/id': 29, 'Modbus/input1deviceId': 1, 'Modbus/input1float': true },
            'Modbus/input1float',
            'unsupported-sensor-type',
        ],
        [{ 'Device/id': 29, 'ExtraDev/extradevices': [33] }, 'ExtraDev/extradevices', 'unsupported-channel'],
        [{ 'Device/id': 29, BTfunction: 'x+1' }, 'BTfunction', 'unsupported-calibration'],
        [{ 'Device/id': 29, BTfunction: null }, 'BTfunction', 'invalid-type'],
        [{ 'Device/id': 29, ChannelTares: null }, 'ChannelTares', 'invalid-type'],
        [
            { 'Device/id': 29, 'Modbus/input1deviceId': 1, 'Modbus/input1register': 65536 },
            'Modbus/input1register',
            'invalid-value',
        ],
    ])('blocks unsafe or incompatible settings %#', (settings, field, code) => {
        const mapped = mapArtisanMachine(snapshot(settings), '4.2.0');
        expect(mapped.draft).toBeNull();
        expect(mapped.issues).toContainEqual({ field, code });
    });
});
