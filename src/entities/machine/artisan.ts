import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import type { Machine } from './types';

export type ArtisanMachineIssue = {
    field: string;
    code:
        | 'missing'
        | 'invalid-type'
        | 'invalid-value'
        | 'needs-version'
        | 'unsupported-device'
        | 'unsupported-transport'
        | 'unsupported-sensor-type'
        | 'unsupported-calibration'
        | 'unsupported-channel';
};

export type ArtisanMachineMapping = {
    sourceId: 'native';
    name: string;
    driver: string;
    transport: string;
    draft: Omit<Machine, 'id' | 'createdAt'> | null;
    issues: ArtisanMachineIssue[];
};

const V4_DEFAULTS: Record<string, unknown> = {
    'Modbus/type': 0,
    'Modbus/comport': 'COM5',
    'Modbus/baudrate': 115200,
    'Modbus/bytesize': 8,
    'Modbus/parity': 'N',
    'Modbus/stopbits': 1,
    'Modbus/host': '127.0.0.1',
    'Modbus/port': 502,
    'Modbus/wordorderLittle': true,
};

const finiteInteger = (value: unknown, min: number, max: number): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
const nonempty = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
// shortcut: only v4.2.0 defaults are verified, extend after comparing another release.
const knownVersion = (source: ArtisanSettingsSnapshot, confirmed: '4.2.0' | null) =>
    source.source.version === '4.2.0' || (source.source.version === null && confirmed === '4.2.0');

export const mapArtisanMachine = (
    source: ArtisanSettingsSnapshot,
    confirmedVersion: '4.2.0' | null,
): ArtisanMachineMapping => {
    const issues: ArtisanMachineIssue[] = [];
    const issue = (field: string, code: ArtisanMachineIssue['code']) => issues.push({ field, code });
    const settings = source.settings;
    const result = (draft: ArtisanMachineMapping['draft'], transport = ''): ArtisanMachineMapping => ({
        sourceId: 'native',
        name: 'Artisan Modbus',
        driver: 'Modbus',
        transport,
        draft,
        issues,
    });
    if (source.status !== 'found') {
        issue('status', 'invalid-value');
        return result(null);
    }
    if (!settings) {
        issue('settings', 'missing');
        return result(null);
    }
    if (settings['Device/id'] !== 29) {
        issue('Device/id', 'unsupported-device');
        return result(null);
    }
    if (!knownVersion(source, confirmedVersion)) {
        issue('source/version', 'needs-version');
        return result(null);
    }
    if ('ExtraDev/extradevices' in settings) {
        const extraDevices = settings['ExtraDev/extradevices'];
        if (!Array.isArray(extraDevices)) issue('ExtraDev/extradevices', 'invalid-type');
        else if (extraDevices.length > 0) issue('ExtraDev/extradevices', 'unsupported-channel');
    }
    for (const key of ['BTfunction', 'ETfunction']) {
        if (!(key in settings)) continue;
        if (typeof settings[key] !== 'string') issue(key, 'invalid-type');
        else if (nonempty(settings[key])) issue(key, 'unsupported-calibration');
    }
    const tares = settings.ChannelTares;
    if ('ChannelTares' in settings) {
        if (!Array.isArray(tares)) issue('ChannelTares', 'invalid-type');
        else if (tares.some((value) => typeof value !== 'number' || value !== 0))
            issue('ChannelTares', 'unsupported-calibration');
    }

    const value = (key: string, fallback: unknown) => (key in settings ? settings[key] : fallback);
    const type = finiteInteger(value('Modbus/type', V4_DEFAULTS['Modbus/type']), 0, 4);
    const modes = ['rtu', 'ascii', '', 'tcp', 'udp'] as const;
    const mode = type === null ? '' : modes[type];
    if (!mode) issue('Modbus/type', type === 2 ? 'unsupported-transport' : 'invalid-value');
    const connectionParams: Record<string, unknown> = { mode };
    if (mode === 'rtu' || mode === 'ascii') {
        const comport = nonempty(value('Modbus/comport', V4_DEFAULTS['Modbus/comport']));
        const baudrate = finiteInteger(value('Modbus/baudrate', V4_DEFAULTS['Modbus/baudrate']), 1, 4_000_000);
        const bytesize = finiteInteger(value('Modbus/bytesize', V4_DEFAULTS['Modbus/bytesize']), 5, 8);
        const parity = value('Modbus/parity', V4_DEFAULTS['Modbus/parity']);
        const stopbits = value('Modbus/stopbits', V4_DEFAULTS['Modbus/stopbits']);
        if (!comport) issue('Modbus/comport', 'invalid-value');
        if (baudrate === null) issue('Modbus/baudrate', 'invalid-value');
        if (bytesize === null) issue('Modbus/bytesize', 'invalid-value');
        if (!['N', 'E', 'O'].includes(typeof parity === 'string' ? parity : ''))
            issue('Modbus/parity', 'invalid-value');
        if (stopbits !== 1 && stopbits !== 2) issue('Modbus/stopbits', 'invalid-value');
        Object.assign(connectionParams, { comport, baudrate, bytesize, parity, stopbits });
    } else if (mode === 'tcp' || mode === 'udp') {
        const host = nonempty(value('Modbus/host', V4_DEFAULTS['Modbus/host']));
        const port = finiteInteger(value('Modbus/port', V4_DEFAULTS['Modbus/port']), 1, 65535);
        if (!host || /[\s/]/.test(host)) issue('Modbus/host', 'invalid-value');
        if (port === null) issue('Modbus/port', 'invalid-value');
        Object.assign(connectionParams, { host, port });
    }

    const registers: Record<'BT' | 'ET', Record<string, unknown> | null> = { BT: null, ET: null };
    for (const [number, role] of [
        [1, 'BT'],
        [2, 'ET'],
    ] as const) {
        const prefix = `Modbus/input${number}`;
        const read = (suffix: string, fallback: unknown) => value(`${prefix}${suffix}`, fallback);
        const unit_id = finiteInteger(read('deviceId', 0), 0, 247);
        if (unit_id === 0) {
            if (role === 'BT') issue(`${prefix}deviceId`, 'missing');
            continue;
        }
        if (unit_id === null) {
            issue(`${prefix}deviceId`, 'invalid-value');
            continue;
        }
        const register = finiteInteger(read('register', 0), 0, 65535);
        const func = finiteInteger(read('code', 3), 3, 4);
        const div = finiteInteger(read('div', 0), 0, 2);
        const unit = read('mode', 'C');
        const signed = read('Signed', false);
        const flags = ['float', 'bcd', 'FloatsAsInt', 'BCDsAsInt'].filter((key) => read(key, false) !== false);
        if (register === null) issue(`${prefix}register`, 'invalid-value');
        if (func === null) issue(`${prefix}code`, 'invalid-value');
        if (div === null) issue(`${prefix}div`, 'invalid-value');
        if (unit !== 'C' && unit !== 'F') issue(`${prefix}mode`, 'invalid-value');
        if (typeof signed !== 'boolean') issue(`${prefix}Signed`, 'invalid-type');
        if (flags.length) issue(`${prefix}${flags[0]}`, 'unsupported-sensor-type');
        registers[role] = { register, func, unit_id, float: false, signed, div, mode: unit };
    }
    const little = value('Modbus/wordorderLittle', V4_DEFAULTS['Modbus/wordorderLittle']);
    if (typeof little !== 'boolean') issue('Modbus/wordorderLittle', 'invalid-type');
    connectionParams.modbus_registers = registers;
    connectionParams.word_order = little ? 'little' : 'big';

    return result(
        issues.length
            ? null
            : {
                  name: 'Artisan Modbus',
                  roasterKey: 'custom_modbus',
                  displayName: 'Artisan Modbus',
                  brand: 'Artisan',
                  models: [],
                  protocol: 'modbus',
                  connectionParams,
                  capabilities: [],
                  pid: null,
                  importSource: { product: 'Artisan', sourceId: 'native' },
              },
        mode,
    );
};
