import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import { describe, expect, it } from 'vitest';
import { mapCropsterMachine } from './cropster';

const snapshot = (tcp = false): CropsterSettingsSnapshot => {
    const factory = tcp ? 'GenericModbusTcpSourceFactory' : 'GenericModbusRtuSourceFactory';
    const sourceFactory = `org.cropster.roastingintelligence.measurement.impl.${factory}`;
    return {
        status: 'found',
        source: { product: 'Cropster', version: '5.13', sourceId: 'default' },
        preferences: null,
        machine: {
            version: '5.13',
            sources: {
                [factory]: {
                    serialPort: '/dev/tty.synthetic',
                    encoding: 'ascii',
                    baudRate: '9600',
                    dataBits: '8',
                    parity: 'Even',
                    stopBits: '2',
                    host: '192.0.2.5',
                    port: '502',
                    modbusFunction: '4',
                    temperatureUnit: 'FAHRENHEIT',
                    bigEndian: 'false',
                    storageFormatTemperature: 'DECIMAL1_16',
                    beanTemperatureSlave: '3',
                    beanTemperatureRegister: '0',
                    exhaustTemperatureSlave: '4',
                    exhaustTemperatureRegister: '1001',
                    filter: 'false',
                },
            },
            channels: ['beanTemperature', 'exhaustTemperature'].map((name) => ({
                name,
                sourceFactory,
                type: 'Default',
                offset: 0,
                index: 99,
                visibility: [],
            })),
        },
    };
};
const channels = (data: CropsterSettingsSnapshot) => data.machine?.channels as Record<string, unknown>[];
const params = (data: CropsterSettingsSnapshot, tcp = false) =>
    ((data.machine?.sources ?? {}) as Record<string, Record<string, unknown>>)[
        tcp ? 'GenericModbusTcpSourceFactory' : 'GenericModbusRtuSourceFactory'
    ];

describe('Cropster machine import', () => {
    it('preserves explicit RTU/ASCII addresses, channel activation, scale, units and serial framing', () => {
        const result = mapCropsterMachine(snapshot());
        expect(result.issues).toEqual([]);
        expect(result.draft).toMatchObject({
            protocol: 'modbus',
            pid: null,
            capabilities: [],
            importSource: { product: 'Cropster', sourceId: 'default' },
            connectionParams: {
                mode: 'ascii',
                comport: '/dev/tty.synthetic',
                baudrate: 9600,
                bytesize: 8,
                parity: 'E',
                stopbits: 2,
                word_order: 'little',
                modbus_registers: {
                    BT: { register: 0, unit_id: 3, func: 4, div: 1, mode: 'F', signed: false, float: false },
                    ET: { register: 1001, unit_id: 4, func: 4, div: 1, mode: 'F', signed: false, float: false },
                },
            },
        });
        expect(result.draft?.connectionParams).not.toHaveProperty('write_map');
    });
    it('uses verified TCP unit/function values and passes register addresses unchanged', () => {
        const data = snapshot(true);
        params(data, true).beanTemperatureRegister = '40001';
        expect(mapCropsterMachine(data).draft?.connectionParams).toMatchObject({
            mode: 'tcp',
            host: '192.0.2.5',
            port: 502,
            modbus_registers: { BT: { register: 40001, unit_id: 1, func: 3 } },
        });
    });
    it('ignores inactive ET parameters and stale unsupported source configurations', () => {
        const data = snapshot();
        channels(data)[1].type = null;
        channels(data)[1].offset = 100;
        params(data).exhaustTemperatureRegister = 'invalid';
        (data.machine?.sources as Record<string, unknown>).ProbatSourceFactory = {};
        expect(mapCropsterMachine(data).draft?.connectionParams.modbus_registers).toMatchObject({ ET: null });
    });
    it('requires active BT rather than human display labels', () => {
        const data = snapshot();
        channels(data)[0].name = 'BT';
        expect(mapCropsterMachine(data).draft).toBeNull();
        channels(data)[0].name = 'beanTemperature';
        channels(data)[0].sourceFactory = null;
        expect(mapCropsterMachine(data).draft).toBeNull();
    });
    it.each([undefined, '5.12', '5.14'])('refuses unverified writer version %s', (version) => {
        const data = snapshot();
        if (data.machine) data.machine.version = version;
        expect(mapCropsterMachine(data).issues).toContainEqual({
            field: 'machine.version',
            code: 'unsupported-version',
        });
        expect(mapCropsterMachine(data).draft).toBeNull();
    });
    it.each(['INTEGER', 'DECIMAL1', 'FLOAT', 'DECIMAL3_16', 'constructor'])(
        'blocks unsupported storage %s',
        (format) => {
            const data = snapshot();
            params(data).storageFormatTemperature = format;
            expect(mapCropsterMachine(data).draft).toBeNull();
        },
    );
    it.each([
        ['INTEGER_16', 0],
        ['DECIMAL1_16', 1],
        ['DECIMAL2_16', 2],
    ] as const)('maps unsigned %s', (format, div) => {
        const data = snapshot();
        params(data).storageFormatTemperature = format;
        expect(mapCropsterMachine(data).draft?.connectionParams.modbus_registers).toMatchObject({
            BT: { div, signed: false },
        });
    });
    it.each(['true', null, false, undefined])('blocks filtering or ambiguous flag %s', (filter) => {
        const data = snapshot();
        params(data).filter = filter;
        expect(mapCropsterMachine(data).draft).toBeNull();
    });
    it('blocks calibration, duplicate temperatures and mismatched active ET factories', () => {
        const data = snapshot();
        channels(data)[0].offset = 5;
        expect(mapCropsterMachine(data).draft).toBeNull();
        channels(data)[0].offset = 0;
        channels(data).push({ ...channels(data)[0] });
        expect(mapCropsterMachine(data).draft).toBeNull();
        channels(data).pop();
        channels(data)[1].sourceFactory = 'org.cropster.roastingintelligence.measurement.impl.ProbatSourceFactory';
        expect(mapCropsterMachine(data).draft).toBeNull();
    });
    it.each([
        ['beanTemperatureSlave', '0'],
        ['beanTemperatureRegister', '65536'],
        ['modbusFunction', '2'],
        ['baudRate', 9600],
        ['bigEndian', true],
        ['temperatureUnit', 'C'],
        ['parity', 'none'],
        ['encoding', 'tcp'],
    ] as const)('rejects invalid %s', (key, value) => {
        const data = snapshot();
        params(data)[key] = value;
        expect(mapCropsterMachine(data).draft).toBeNull();
    });
    it('keeps valid temperatures when unrelated additional channels are skipped', () => {
        const data = snapshot();
        channels(data).push({ ...channels(data)[0], name: 'gas' });
        expect(mapCropsterMachine(data).draft).not.toBeNull();
        expect(mapCropsterMachine(data).issues).toContainEqual({ field: 'channels[2]', code: 'unsupported-channel' });
    });
});
