import type { Machine } from './types';

export type FirescopeMachineIssue = {
    field: string;
    code:
        | 'missing'
        | 'invalid-type'
        | 'invalid-value'
        | 'unsupported-driver'
        | 'unsupported-transport'
        | 'unsupported-sensor-type'
        | 'unsupported-unit'
        | 'unsupported-compensation'
        | 'unsupported-channel'
        | 'duplicate-channel';
};

export type FirescopeMachineMapping = {
    sourceId: string | null;
    name: string;
    driver: string;
    transport: string;
    draft: Omit<Machine, 'id' | 'createdAt'> | null;
    issues: FirescopeMachineIssue[];
};

type Obj = Record<string, unknown>;

const object = (value: unknown): Obj | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const finite = (value: unknown, min: number, max: number): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const integer = (value: unknown, min: number, max: number): number | null => {
    const result = finite(value, min, max);
    return result !== null && Number.isInteger(result) ? result : null;
};
const networkHost = (value: unknown): string | null => {
    const result = text(value);
    return result && !/[\s/]/.test(result) ? result : null;
};

const parity = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    return ({ none: 'N', even: 'E', odd: 'O' } as Record<string, string>)[value.toLowerCase()] ?? null;
};

const sensorRole = (sensor: Obj): 'BT' | 'ET' | null => {
    const value = text(sensor.label);
    if (!value) return null;
    const normalized = value.toUpperCase().replace(/[^A-Z]/g, '');
    if (normalized === 'BT' || normalized === 'BEANTEMPERATURE') return 'BT';
    if (normalized === 'ET' || normalized === 'EXHAUSTTEMPERATURE') return 'ET';
    return null;
};

const readSensors = (raw: Obj): unknown[] => {
    const connection = object(raw.connection);
    const protocol = text(connection?.protocol);
    const values = protocol ? connection?.[protocol] : undefined;
    return Array.isArray(values) ? values : [];
};

export const mapFirescopeMachine = (raw: Record<string, unknown>): FirescopeMachineMapping => {
    const issues: FirescopeMachineIssue[] = [];
    const issue = (field: string, code: FirescopeMachineIssue['code']) => issues.push({ field, code });
    const sourceId = typeof raw.id === 'string' && raw.id.trim() ? raw.id : null;
    const name = text(raw.name) ?? 'Firescope machine';
    const connection = object(raw.connection);
    const driver = text(connection?.driver) ?? '';
    const transport = text(connection?.type)?.toLowerCase() ?? '';
    const result = (draft: FirescopeMachineMapping['draft']): FirescopeMachineMapping => ({
        sourceId,
        name,
        driver,
        transport,
        draft,
        issues,
    });
    if (raw.id == null) issue('id', 'missing');
    else if (!sourceId) issue('id', 'invalid-type');

    if (!connection) {
        issue('connection', 'missing');
        return result(null);
    }
    if (!driver) {
        issue('connection.driver', 'missing');
        return result(null);
    }
    const isModbus = driver === 'ModbusDriver' || driver === 'EasysterSmartDriver';
    if (!isModbus && driver !== 'S7Driver') {
        issue('connection.driver', 'unsupported-driver');
        return result(null);
    }

    const sensors = readSensors(raw);
    const sensorPath = `connection.${text(connection.protocol) ?? 'sensors'}`;
    const mapped = new Map<'BT' | 'ET', { sensor: Obj; index: number }>();
    sensors.forEach((value, index) => {
        const sensor = object(value);
        if (!sensor) {
            issue(`${sensorPath}[${index}]`, 'invalid-type');
            return;
        }
        const role = sensorRole(sensor);
        if (!role) issue(`${sensorPath}[${index}]`, 'unsupported-channel');
        else if (mapped.has(role)) issue(`${sensorPath}[${index}]`, 'duplicate-channel');
        else mapped.set(role, { sensor, index });
    });
    if (!mapped.has('BT')) issue(`${sensorPath}.BT`, 'missing');

    let protocol: 'modbus' | 's7';
    let roasterKey: 'custom_modbus' | 'custom_s7';
    let connectionParams: Obj = {};

    if (isModbus) {
        protocol = 'modbus';
        roasterKey = 'custom_modbus';
        if (text(connection.protocol)?.toLowerCase() !== 'modbus')
            issue('connection.protocol', 'unsupported-transport');
        const selected = object(connection[transport]) ?? {};
        const mode = text(selected.type)?.toLowerCase();
        if (!['rtu', 'ascii', 'tcp', 'udp'].includes(mode ?? ''))
            issue(`connection.${transport}.type`, 'unsupported-transport');
        if ((mode === 'rtu' || mode === 'ascii') && transport !== 'serial')
            issue('connection.type', 'unsupported-transport');
        if ((mode === 'tcp' || mode === 'udp') && transport !== 'ethernet')
            issue('connection.type', 'unsupported-transport');
        const settings = selected;
        if (!mode) return result(null);
        if (mode === 'rtu' || mode === 'ascii') {
            const comport = text(settings.path);
            const baudrate = integer(settings.baudRate, 1, 4_000_000);
            const bytesize = integer(settings.dataBits, 5, 8);
            const stopbits = finite(settings.stopBits, 1, 2);
            const parityValue = parity(settings.parity);
            if (!comport) issue(`connection.${transport}.path`, 'invalid-value');
            if (baudrate === null) issue(`connection.${transport}.baudRate`, 'invalid-value');
            if (bytesize === null) issue(`connection.${transport}.dataBits`, 'invalid-value');
            if (stopbits !== 1 && stopbits !== 2) issue(`connection.${transport}.stopBits`, 'invalid-value');
            if (!parityValue) issue(`connection.${transport}.parity`, 'invalid-value');
            connectionParams = { mode, comport, baudrate, bytesize, stopbits, parity: parityValue };
        } else {
            const host = networkHost(settings.ip);
            const port = integer(settings.port, 1, 65535);
            if (!host) issue(`connection.${transport}.ip`, 'invalid-value');
            if (port === null) issue(`connection.${transport}.port`, 'invalid-value');
            connectionParams = { mode, host, port };
        }

        const registers: Record<string, Obj | null> = { BT: null, ET: null };
        for (const role of ['BT', 'ET'] as const) {
            const mappedSensor = mapped.get(role);
            if (!mappedSensor) continue;
            const { sensor, index } = mappedSensor;
            const prefix = `${sensorPath}[${index}]`;
            const register = integer(sensor.address, 0, 65535);
            const rawRead =
                typeof sensor.read === 'string' ? Number(sensor.read.toUpperCase().replace('FC', '')) : sensor.read;
            const func = integer(rawRead, 3, 4);
            const unit_id = integer(sensor.sensorId, 0, 247);
            const div = integer(sensor.decimalPlace, 0, 2);
            const unit = text(sensor.unit)?.replace('°', '').toUpperCase();
            const compensation = finite(sensor.compensation ?? 0, -1_000_000, 1_000_000);
            if (text(sensor.type) !== 'integer') issue(`${prefix}.type`, 'unsupported-sensor-type');
            if (register === null) issue(`${prefix}.address`, 'invalid-value');
            if (func === null) issue(`${prefix}.read`, 'invalid-value');
            if (unit_id === null) issue(`${prefix}.sensorId`, 'invalid-value');
            if (div === null) issue(`${prefix}.decimalPlace`, 'invalid-value');
            if (unit !== 'C' && unit !== 'F') issue(`${prefix}.unit`, 'unsupported-unit');
            if (compensation !== 0) issue(`${prefix}.compensation`, 'unsupported-compensation');
            registers[role] = { register, func, unit_id, float: false, signed: true, div, mode: unit };
        }
        connectionParams = { ...connectionParams, modbus_registers: registers };
    } else {
        protocol = 's7';
        roasterKey = 'custom_s7';
        if (transport !== 'ethernet') issue('connection.type', 'unsupported-transport');
        if (text(connection.protocol)?.toLowerCase() !== 's7') issue('connection.protocol', 'unsupported-transport');
        const settings = object(connection.ethernet) ?? {};
        if (text(settings.type)?.toLowerCase() !== 'tcp') issue('connection.ethernet.type', 'unsupported-transport');
        const host = networkHost(settings.ip);
        const port = integer(settings.port ?? 102, 1, 65535);
        const slot = integer(connection.slot ?? 1, 0, 255);
        if (!host) issue('connection.ethernet.ip', 'invalid-value');
        if (port === null) issue('connection.ethernet.port', 'invalid-value');
        if (slot === null) issue('connection.slot', 'invalid-value');
        const channels: Obj[] = [];
        for (const role of ['BT', 'ET'] as const) {
            const mappedSensor = mapped.get(role);
            if (!mappedSensor) continue;
            const { sensor, index } = mappedSensor;
            const prefix = `${sensorPath}[${index}]`;
            const db = integer(sensor.address, 0, 65535);
            const offset = integer(sensor.start, 0, 2_147_483_647);
            const sourceType = text(sensor.type);
            const type = sourceType === 'integer' ? 0 : sourceType === 'float' ? 1 : null;
            const div = integer(sensor.decimalPlace, 0, 2);
            const unit = text(sensor.unit)?.replace('°', '').toUpperCase();
            const compensation = finite(sensor.compensation ?? 0, -1_000_000, 1_000_000);
            if (db === null) issue(`${prefix}.address`, 'invalid-value');
            if (offset === null) issue(`${prefix}.start`, 'invalid-value');
            if (type === null) issue(`${prefix}.type`, 'unsupported-sensor-type');
            if (div === null) issue(`${prefix}.decimalPlace`, 'invalid-value');
            if (unit !== 'C') issue(`${prefix}.unit`, 'unsupported-unit');
            if (compensation !== 0) issue(`${prefix}.compensation`, 'unsupported-compensation');
            channels.push({ role, db, offset, area: 6, type, div });
        }
        connectionParams = { host, port, rack: 0, slot, channels };
    }

    const blocking = issues.some((entry) => entry.code !== 'unsupported-channel');
    return result(
        blocking
            ? null
            : {
                  name,
                  roasterKey,
                  displayName: name,
                  brand: 'Firescope',
                  models: [],
                  protocol,
                  connectionParams,
                  capabilities: [],
                  pid: null,
                  ...(sourceId ? { importSource: { product: 'Firescope' as const, sourceId } } : {}),
              },
    );
};
