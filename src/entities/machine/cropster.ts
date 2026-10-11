import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import type { Machine } from './types';

type IssueCode =
    | 'missing'
    | 'invalid-type'
    | 'invalid-value'
    | 'unsupported-version'
    | 'unsupported-driver'
    | 'unsupported-transport'
    | 'unsupported-sensor-type'
    | 'unsupported-calibration'
    | 'unsupported-unit'
    | 'unsupported-channel'
    | 'duplicate-channel';
export type CropsterMachineMapping = {
    sourceId: 'default';
    name: string;
    driver: string;
    transport: string;
    draft: Omit<Machine, 'id' | 'createdAt'> | null;
    issues: { field: string; code: IssueCode }[];
};
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null;
const integer = (value: unknown, min: number, max: number): number | null => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
};
const FACTORY_PREFIX = 'org.cropster.roastingintelligence.measurement.impl.';
const STORAGE_DIVISORS = new Map([
    ['INTEGER_16', 0],
    ['DECIMAL1_16', 1],
    ['DECIMAL2_16', 2],
]);

export const mapCropsterMachine = (source: CropsterSettingsSnapshot): CropsterMachineMapping => {
    const issues: CropsterMachineMapping['issues'] = [];
    const issue = (field: string, code: IssueCode) => issues.push({ field, code });
    const result = (draft: CropsterMachineMapping['draft'], transport = ''): CropsterMachineMapping => ({
        sourceId: 'default',
        name: 'Cropster Modbus',
        driver: 'Modbus',
        transport,
        draft,
        issues,
    });
    if (source.status !== 'found' || !source.machine) {
        issue('machine', 'missing');
        return result(null);
    }
    const machine = source.machine;
    // shortcut: only RI 5.13 decoding is verified, extend after comparing another release.
    if (machine.version !== '5.13') {
        issue('machine.version', 'unsupported-version');
        return result(null);
    }
    if (!Array.isArray(machine.channels)) {
        issue('channels', 'invalid-type');
        return result(null);
    }
    const channels = new Map<'BT' | 'ET', Obj>();
    machine.channels.forEach((raw, index) => {
        const channel = object(raw);
        if (!channel) {
            issue(`channels[${index}]`, 'invalid-type');
            return;
        }
        if (channel.sourceFactory == null || channel.type == null) return;
        const role = channel.name === 'beanTemperature' ? 'BT' : channel.name === 'exhaustTemperature' ? 'ET' : null;
        if (!role) {
            issue(`channels[${index}]`, 'unsupported-channel');
            return;
        }
        if (channels.has(role)) issue(`channels[${index}]`, 'duplicate-channel');
        channels.set(role, channel);
        if (channel.type !== 'Default') issue(`channels[${index}].type`, 'unsupported-sensor-type');
        if (channel.offset !== 0) issue(`channels[${index}].offset`, 'unsupported-calibration');
    });
    const bt = channels.get('BT');
    if (!bt) {
        issue('channels.BT', 'missing');
        return result(null);
    }
    const factory =
        bt.sourceFactory === `${FACTORY_PREFIX}GenericModbusRtuSourceFactory`
            ? 'GenericModbusRtuSourceFactory'
            : bt.sourceFactory === `${FACTORY_PREFIX}GenericModbusTcpSourceFactory`
              ? 'GenericModbusTcpSourceFactory'
              : null;
    if (!factory) {
        issue('channels.BT.sourceFactory', 'unsupported-driver');
        return result(null);
    }
    const params = object(object(machine.sources)?.[factory]);
    if (!params) {
        issue(`sources.${factory}`, 'missing');
        return result(null);
    }
    const field = (key: string) => `sources.${factory}.${key}`;
    const rtu = factory === 'GenericModbusRtuSourceFactory';
    const mode = rtu ? params.encoding : 'tcp';
    const connectionParams: Obj = { mode };
    if (rtu && mode !== 'rtu' && mode !== 'ascii') issue(field('encoding'), 'unsupported-transport');
    if (rtu) {
        const comport = typeof params.serialPort === 'string' ? params.serialPort.trim() : '';
        const baudrate = integer(params.baudRate, 1, 4_000_000);
        const bytesize = integer(params.dataBits, 5, 8);
        const stopbits = integer(params.stopBits, 1, 2);
        const parity =
            params.parity === 'None' ? 'N' : params.parity === 'Odd' ? 'O' : params.parity === 'Even' ? 'E' : null;
        if (!comport) issue(field('serialPort'), 'invalid-value');
        if (baudrate === null) issue(field('baudRate'), 'invalid-value');
        if (bytesize === null) issue(field('dataBits'), 'invalid-value');
        if (stopbits === null) issue(field('stopBits'), 'invalid-value');
        if (!parity) issue(field('parity'), 'invalid-value');
        Object.assign(connectionParams, { comport, baudrate, bytesize, stopbits, parity });
    } else {
        const host = typeof params.host === 'string' ? params.host.trim() : '';
        const port = integer(params.port, 1, 65535);
        if (!host || /[\s/]/.test(host)) issue(field('host'), 'invalid-value');
        if (port === null) issue(field('port'), 'invalid-value');
        Object.assign(connectionParams, { host, port });
    }
    if (params.filter !== 'false') issue(field('filter'), 'unsupported-calibration');
    if (params.bigEndian !== 'true' && params.bigEndian !== 'false') issue(field('bigEndian'), 'invalid-type');
    const unit = params.temperatureUnit === 'CELSIUS' ? 'C' : params.temperatureUnit === 'FAHRENHEIT' ? 'F' : null;
    if (!unit) issue(field('temperatureUnit'), 'unsupported-unit');
    const div =
        typeof params.storageFormatTemperature === 'string'
            ? STORAGE_DIVISORS.get(params.storageFormatTemperature)
            : undefined;
    if (div === undefined) issue(field('storageFormatTemperature'), 'unsupported-sensor-type');
    const func = rtu ? integer(params.modbusFunction, 3, 4) : 3;
    if (func === null) issue(field('modbusFunction'), 'invalid-value');
    const registers: Record<'BT' | 'ET', Obj | null> = { BT: null, ET: null };
    for (const [role, channel] of channels) {
        if (channel.sourceFactory !== bt.sourceFactory) issue(`channels.${role}.sourceFactory`, 'unsupported-driver');
        const prefix = role === 'BT' ? 'beanTemperature' : 'exhaustTemperature';
        const register = integer(params[`${prefix}Register`], 0, 65535);
        const unit_id = rtu ? integer(params[`${prefix}Slave`], 1, 247) : 1;
        if (register === null) issue(field(`${prefix}Register`), 'invalid-value');
        if (unit_id === null) issue(field(`${prefix}Slave`), 'invalid-value');
        registers[role] = { register, func, unit_id, float: false, signed: false, div, mode: unit };
    }
    connectionParams.modbus_registers = registers;
    connectionParams.word_order = params.bigEndian === 'true' ? 'big' : 'little';
    return result(
        issues.some(({ code }) => code !== 'unsupported-channel')
            ? null
            : {
                  name: 'Cropster Modbus',
                  roasterKey: 'custom_modbus',
                  displayName: 'Cropster Modbus',
                  brand: 'Cropster',
                  models: [],
                  protocol: 'modbus',
                  connectionParams,
                  capabilities: [],
                  pid: null,
                  importSource: { product: 'Cropster', sourceId: 'default' },
              },
        typeof mode === 'string' ? mode : '',
    );
};
