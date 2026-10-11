import { describe, expect, it } from 'vitest';
import { firescopeFeedbackUpdate, mapFirescopeMachine } from './firescope';
import type { Machine } from './types';

describe('Firescope feedback upgrades', () => {
    it.each(['modbus', 's7'])('adds missing %s feedback without replacing edits or existing channels', (protocol) => {
        const saved =
            protocol === 'modbus'
                ? { modbus_registers: { BT: { register: 99 }, ET: null, heater: { register: 42, unit: '%' } } }
                : {
                      channels: [
                          { role: 'BT', db: 2, offset: 0 },
                          { role: 'heater', db: 2, offset: 8, unit: '%' },
                      ],
                  };
        const incoming =
            protocol === 'modbus'
                ? {
                      modbus_registers: {
                          BT: { register: 19 },
                          heater: { register: 21, unit: '%' },
                          fan: { register: 22, unit: 'Pa' },
                      },
                  }
                : {
                      channels: [
                          { role: 'BT', db: 3, offset: 0 },
                          { role: 'heater', db: 3, offset: 8, unit: '%' },
                          { role: 'fan', db: 3, offset: 16, unit: 'Pa' },
                      ],
                  };
        const draft = {
            name: 'Source',
            roasterKey: `custom_${protocol}`,
            displayName: 'Source',
            brand: 'Firescope',
            models: [],
            protocol,
            connectionParams: incoming,
            capabilities: ['heater', 'fan'],
            pid: null,
            importSource: { product: 'Firescope' as const, sourceId: 42 },
        };
        const existing: Machine = {
            ...draft,
            id: 'saved',
            createdAt: '2026-01-01',
            name: 'My machine',
            connectionParams: { ...saved, host: 'edited-host' },
            capabilities: ['heater'],
        };
        const patch = firescopeFeedbackUpdate(existing, draft);
        expect(patch?.capabilities).toEqual(['heater', 'fan']);
        expect(patch?.connectionParams.host).toBe('edited-host');
        if (protocol === 'modbus')
            expect(patch?.connectionParams.modbus_registers).toEqual({
                ...saved.modbus_registers,
                fan: incoming.modbus_registers?.fan,
            });
        else expect(patch?.connectionParams.channels).toEqual([...(saved.channels ?? []), incoming.channels?.[2]]);
        expect(existing.name).toBe('My machine');
        expect(firescopeFeedbackUpdate({ ...existing, ...patch }, draft)).toBeNull();
        expect(
            firescopeFeedbackUpdate({ ...existing, importSource: { product: 'Firescope', sourceId: '42' } }, draft),
        ).toBeNull();
        expect(firescopeFeedbackUpdate({ ...existing, protocol: 'different' }, draft)).toBeNull();
        expect(existing.connectionParams).toEqual({ ...saved, host: 'edited-host' });
    });
});

const modbusMachine = {
    id: 'firescope-1',
    name: 'dfa',
    connection: {
        driver: 'ModbusDriver',
        type: 'serial',
        protocol: 'modbus',
        serial: {
            type: 'rtu',
            path: '/dev/tty.usbserial',
            baudRate: 9600,
            dataBits: 8,
            stopBits: 2,
            parity: 'none',
        },
        modbus: [
            {
                label: 'bt',
                address: 1000,
                read: 'FC4',
                sensorId: 1,
                type: 'integer',
                decimalPlace: 1,
                unit: '°C',
                compensation: 0,
            },
            {
                label: 'et',
                address: 1000,
                read: 'FC4',
                sensorId: 1,
                type: 'integer',
                decimalPlace: 1,
                unit: 'C',
                compensation: 0,
            },
        ],
    },
};

describe('mapFirescopeMachine', () => {
    it.each(['rtu', 'ascii'])('maps signed Modbus %s readings without inheriting control settings', (mode) => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                serial: { ...modbusMachine.connection.serial, type: mode },
                write_map: { heater: { register: 31 } },
                modbus: modbusMachine.connection.modbus.map((sensor) => ({ ...sensor, write: 'FC6' })),
            },
        });
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft).toMatchObject({
            roasterKey: 'custom_modbus',
            protocol: 'modbus',
            capabilities: [],
            pid: null,
            importSource: { product: 'Firescope', sourceId: 'firescope-1' },
            connectionParams: {
                mode,
                comport: '/dev/tty.usbserial',
                baudrate: 9600,
                bytesize: 8,
                stopbits: 2,
                parity: 'N',
                modbus_registers: {
                    BT: { register: 1000, func: 4, unit_id: 1, float: false, signed: true, div: 1, mode: 'C' },
                    ET: { register: 1000, func: 4, unit_id: 1, float: false, signed: true, div: 1, mode: 'C' },
                },
            },
        });
        expect(mapped.draft?.connectionParams).not.toHaveProperty('write_map');
        expect(mapped.draft?.connectionParams.modbus_registers).toEqual(
            mapFirescopeMachine(modbusMachine).draft?.connectionParams.modbus_registers,
        );
    });

    it('uses only the selected ethernet transport and maps S7 DB offsets', () => {
        const mapped = mapFirescopeMachine({
            id: 's7-1',
            name: 'ㅇㄹ',
            connection: {
                driver: 'S7Driver',
                type: 'ethernet',
                protocol: 's7',
                serial: { path: '/dev/stale', baudRate: 1200 },
                write_map: { heater: { db: 2, offset: 18, type: 0 } },
                slot: 1,
                ethernet: { type: 'tcp', ip: '192.168.0.8', port: 102 },
                s7: [
                    { label: 'bt', address: 2, start: 38, type: 'integer', decimalPlace: 0, unit: 'C' },
                    { label: 'et', address: 2, start: 36, type: 'integer', decimalPlace: 0, unit: 'C' },
                ],
            },
        });
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft?.connectionParams).toEqual({
            host: '192.168.0.8',
            port: 102,
            rack: 0,
            slot: 1,
            channels: [
                { role: 'BT', db: 2, offset: 38, area: 6, type: 0, div: 0 },
                { role: 'ET', db: 2, offset: 36, area: 6, type: 0, div: 0 },
            ],
        });
    });

    it('maps Modbus TCP from ethernet and ignores stale serial settings', () => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                type: 'ethernet',
                serial: { type: 'rtu', path: '/dev/stale' },
                ethernet: { type: 'tcp', ip: '192.0.2.2', port: 502 },
            },
        });
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft?.connectionParams).toMatchObject({ mode: 'tcp', host: '192.0.2.2', port: 502 });
        expect(mapped.draft?.connectionParams).not.toHaveProperty('comport');
    });

    it.each(['ascii', 'udp'])('preserves Modbus %s framing', (mode) => {
        const connection =
            mode === 'ascii'
                ? { ...modbusMachine.connection, serial: { ...modbusMachine.connection.serial, type: mode } }
                : {
                      ...modbusMachine.connection,
                      type: 'ethernet',
                      ethernet: { type: mode, ip: '192.0.2.2', host: 'stale.invalid', port: 502 },
                  };
        const mapped = mapFirescopeMachine({ ...modbusMachine, connection });
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft?.connectionParams.mode).toBe(mode);
        if (mode === 'udp') expect(mapped.draft?.connectionParams.host).toBe('192.0.2.2');
    });

    it('preserves source identity and uses the verified Firescope default S7 slot', () => {
        const mapped = mapFirescopeMachine({
            id: ' id ',
            connection: {
                driver: 'S7Driver',
                type: 'ethernet',
                protocol: 's7',
                ethernet: { type: 'tcp', ip: '192.0.2.3', host: 'stale.invalid', slot: 7 },
                s7: [{ label: 'bt', address: 2, start: 38, type: 'float', decimalPlace: 1, unit: 'C' }],
            },
        });
        expect(mapped.draft?.importSource?.sourceId).toBe(' id ');
        expect(mapped.draft?.connectionParams).toEqual({
            host: '192.0.2.3',
            port: 102,
            rack: 0,
            slot: 1,
            channels: [{ role: 'BT', db: 2, offset: 38, area: 6, type: 1, div: 1 }],
        });
    });

    it('reports unknown channels without blocking valid BT/ET', () => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                modbus: [...modbusMachine.connection.modbus, { label: 'mystery', address: 21 }],
            },
        });
        expect(mapped.draft).not.toBeNull();
        expect(mapped.issues).toEqual([{ field: 'connection.modbus[2]', code: 'unsupported-channel' }]);
    });

    it('maps Modbus heat, fan, and drum feedback without importing writes', () => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                modbus: [
                    ...modbusMachine.connection.modbus,
                    {
                        label: 'power',
                        address: 21,
                        read: 'FC3',
                        sensorId: 1,
                        type: 'integer',
                        decimalPlace: 1,
                        unit: '%',
                        compensation: 0,
                    },
                    {
                        label: 'airflowPressure',
                        address: 22,
                        read: 'FC3',
                        sensorId: 1,
                        type: 'integer',
                        decimalPlace: 0,
                        unit: '%',
                        compensation: 0,
                    },
                    {
                        label: 'drumSpeed',
                        address: 23,
                        read: 'FC4',
                        sensorId: 2,
                        type: 'integer',
                        decimalPlace: 2,
                        unit: 'RPM',
                        compensation: 0,
                    },
                    {
                        label: 'powerSetting',
                        address: 31,
                        read: 'FC3',
                        sensorId: 1,
                        type: 'integer',
                        decimalPlace: 0,
                        unit: '%',
                        compensation: 0,
                    },
                ],
            },
        });
        expect(mapped.draft?.capabilities).toEqual(['heater', 'fan', 'drum']);
        expect(mapped.draft?.connectionParams.modbus_registers).toMatchObject({
            heater: { register: 21, func: 3, unit_id: 1, signed: true, div: 1, unit: '%' },
            fan: { register: 22, func: 3, unit_id: 1, signed: true, div: 0, unit: '%' },
            drum: { register: 23, func: 4, unit_id: 2, signed: true, div: 2, unit: 'RPM' },
        });
        expect(mapped.draft?.connectionParams).not.toHaveProperty('write_map');
        expect(mapped.draft?.connectionParams.modbus_registers).not.toHaveProperty('powerSetting');
        expect(mapped.issues).toContainEqual({ field: 'connection.modbus[5]', code: 'unsupported-channel' });
    });

    it('maps S7 feedback with percent, pressure, and frequency units', () => {
        const mapped = mapFirescopeMachine({
            id: 's7-feedback',
            name: 'S7 feedback',
            connection: {
                driver: 'S7Driver',
                type: 'ethernet',
                protocol: 's7',
                slot: 1,
                ethernet: { type: 'tcp', ip: '192.0.2.8', port: 102 },
                s7: [
                    {
                        label: 'bt',
                        address: 2,
                        start: 38,
                        type: 'integer',
                        decimalPlace: 0,
                        unit: 'C',
                        compensation: 0,
                    },
                    {
                        label: 'heat',
                        address: 2,
                        start: 48,
                        type: 'integer',
                        decimalPlace: 1,
                        unit: '%',
                        compensation: 0,
                    },
                    {
                        label: 'fan',
                        address: 2,
                        start: 50,
                        type: 'float',
                        decimalPlace: 0,
                        unit: 'Pa',
                        compensation: 0,
                    },
                    {
                        label: 'drum',
                        address: 2,
                        start: 54,
                        type: 'float',
                        decimalPlace: 2,
                        unit: 'Hz',
                        compensation: 0,
                    },
                ],
            },
        });
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft?.capabilities).toEqual(['heater', 'fan', 'drum']);
        expect(mapped.draft?.connectionParams.channels).toEqual([
            { role: 'BT', db: 2, offset: 38, area: 6, type: 0, div: 0 },
            { role: 'heater', db: 2, offset: 48, area: 6, type: 0, div: 1, unit: '%' },
            { role: 'fan', db: 2, offset: 50, area: 6, type: 1, div: 0, unit: 'Pa' },
            { role: 'drum', db: 2, offset: 54, area: 6, type: 1, div: 2, unit: 'Hz' },
        ]);
    });

    it('blocks mapped feedback with an incompatible unit', () => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                modbus: [
                    ...modbusMachine.connection.modbus,
                    {
                        label: 'power',
                        address: 21,
                        read: 'FC3',
                        sensorId: 1,
                        type: 'integer',
                        decimalPlace: 0,
                        unit: 'Pa',
                        compensation: 0,
                    },
                ],
            },
        });
        expect(mapped.draft).toBeNull();
        expect(mapped.issues).toContainEqual({ field: 'connection.modbus[2].unit', code: 'unsupported-unit' });
    });

    it.each([0, 42, Number.MAX_SAFE_INTEGER])('preserves numeric source id %s and sensor addresses', (id) => {
        const mapped = mapFirescopeMachine({ ...modbusMachine, id });
        expect(mapped.draft).not.toBeNull();
        expect(mapped.sourceId).toBe(id);
        expect(mapped.draft?.importSource).toEqual({ product: 'Firescope', sourceId: id });
        expect(mapped.draft?.connectionParams).toEqual(mapFirescopeMachine(modbusMachine).draft?.connectionParams);
        expect(mapped.issues).toEqual([]);
    });

    it.each([
        [undefined, 'missing'],
        ['', 'invalid-type'],
        ['   ', 'invalid-type'],
        [true, 'invalid-type'],
        [42.5, 'invalid-type'],
        [Number.MAX_SAFE_INTEGER + 1, 'invalid-type'],
        [Number.NaN, 'invalid-type'],
        [Number.POSITIVE_INFINITY, 'invalid-type'],
        [{ id: 42 }, 'invalid-type'],
    ])('blocks invalid source id %s', (id, code) => {
        const raw = { ...modbusMachine, id };
        const mapped = mapFirescopeMachine(raw);
        expect(mapped.sourceId).toBeNull();
        expect(mapped.draft).toBeNull();
        expect(mapped.issues).toContainEqual({ field: 'id', code });
    });

    it('blocks duplicate temperature roles instead of choosing the first sensor', () => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                modbus: [...modbusMachine.connection.modbus, { ...modbusMachine.connection.modbus[0] }],
            },
        });
        expect(mapped.draft).toBeNull();
        expect(mapped.issues).toContainEqual({ field: 'connection.modbus[2]', code: 'duplicate-channel' });
    });

    it.each([
        [
            { ...modbusMachine, connection: { ...modbusMachine.connection, driver: 'UnknownDriver' } },
            'unsupported-driver',
        ],
        [
            {
                ...modbusMachine,
                connection: {
                    ...modbusMachine.connection,
                    serial: { ...modbusMachine.connection.serial, stopBits: 1.5 },
                },
            },
            'invalid-value',
        ],
        [
            {
                ...modbusMachine,
                connection: {
                    ...modbusMachine.connection,
                    modbus: [{ ...modbusMachine.connection.modbus[0], type: 'float' }],
                },
            },
            'unsupported-sensor-type',
        ],
        [
            {
                ...modbusMachine,
                connection: {
                    ...modbusMachine.connection,
                    modbus: [{ ...modbusMachine.connection.modbus[0], compensation: 1 }],
                },
            },
            'unsupported-compensation',
        ],
    ])('blocks unsupported required settings', (raw, code) => {
        const mapped = mapFirescopeMachine(raw);
        expect(mapped.draft).toBeNull();
        expect(mapped.issues.some((issue) => issue.code === code)).toBe(true);
    });
});
