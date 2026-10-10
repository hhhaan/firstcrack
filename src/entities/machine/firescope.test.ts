import { describe, expect, it } from 'vitest';
import { mapFirescopeMachine } from './firescope';

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
    it('maps signed Modbus RTU readings without inheriting control settings', () => {
        const mapped = mapFirescopeMachine(modbusMachine);
        expect(mapped.issues).toEqual([]);
        expect(mapped.draft).toMatchObject({
            roasterKey: 'custom_modbus',
            protocol: 'modbus',
            capabilities: [],
            pid: null,
            importSource: { product: 'Firescope', sourceId: 'firescope-1' },
            connectionParams: {
                mode: 'rtu',
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

    it('reports extra channels without blocking valid BT/ET', () => {
        const mapped = mapFirescopeMachine({
            ...modbusMachine,
            connection: {
                ...modbusMachine.connection,
                modbus: [...modbusMachine.connection.modbus, { label: 'power', address: 21 }],
            },
        });
        expect(mapped.draft).not.toBeNull();
        expect(mapped.issues).toEqual([{ field: 'connection.modbus[2]', code: 'unsupported-channel' }]);
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
