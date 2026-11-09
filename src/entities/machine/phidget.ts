import type { RoasterDef } from './types';

export const PHIDGET_MODELS = ['TMP1101', 'TMP1200', 'TMP1202', '1048'] as const;
export const PHIDGET_THERMOCOUPLES = ['K', 'J', 'E', 'T'] as const;
export const PHIDGET_RTDS = ['PT100_3850', 'PT100_3920', 'PT1000_3850', 'PT1000_3920'] as const;
export const isPhidgetRtd = (model: string): boolean => model === 'TMP1200' || model === 'TMP1202';

export const initPhidgetParams = (def: RoasterDef, existing?: Record<string, unknown>): Record<string, string> => {
    const saved = { ...def.default_params, ...existing };
    const params: Record<string, string> = {};
    for (const role of ['bt', 'et']) {
        const values = {
            device_type: saved[`${role}_device_type`] ?? saved.device_type ?? 'TMP1101',
            serial_number: `${role}_serial_number` in saved ? saved[`${role}_serial_number`] : saved.serial_number,
            hub_port: saved[`${role}_hub_port`],
            thermocouple_type: saved[`${role}_thermocouple_type`] ?? 'K',
            rtd_type: saved[`${role}_rtd_type`] ?? 'PT1000_3850',
            rtd_wire_setup: saved[`${role}_rtd_wire_setup`] ?? 4,
        };
        for (const [key, value] of Object.entries(values))
            params[`${role}_${key}`] = value == null ? '' : String(value);
        const channel = saved[`channel_${role}`];
        params[`channel_${role}`] = channel == null ? (role === 'bt' ? '0' : '') : String(channel);
    }
    return params;
};

export const buildPhidgetParams = (params: Record<string, string>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const role of ['bt', 'et']) {
        result[`channel_${role}`] = params[`channel_${role}`]?.trim() ? Number(params[`channel_${role}`]) : null;
        for (const key of [
            'device_type',
            'serial_number',
            'hub_port',
            'thermocouple_type',
            'rtd_type',
            'rtd_wire_setup',
        ]) {
            const raw = params[`${role}_${key}`]?.trim();
            result[`${role}_${key}`] = !raw
                ? null
                : ['serial_number', 'hub_port', 'rtd_wire_setup'].includes(key)
                  ? Number(raw)
                  : raw;
        }
    }
    return result;
};

export const invalidPhidgetField = (params: Record<string, string>): string | null => {
    const integerInRange = (raw: string | undefined, min: number, max: number) =>
        Boolean(raw?.trim()) && Number.isInteger(Number(raw)) && Number(raw) >= min && Number(raw) <= max;
    for (const role of ['bt', 'et']) {
        if (role === 'et' && !params.channel_et?.trim()) continue;
        const label = role.toUpperCase();
        const model = params[`${role}_device_type`];
        if (!PHIDGET_MODELS.some((value) => value === model)) return `${label} Model`;
        if (!integerInRange(params[`channel_${role}`], 0, isPhidgetRtd(model) ? 0 : 3)) return `${label} Channel`;
        const serial = params[`${role}_serial_number`];
        if (serial?.trim() && !integerInRange(serial, 1, 2147483647)) return `${label} Serial Number`;
        const hub = params[`${role}_hub_port`];
        if (model !== '1048' && hub?.trim() && !integerInRange(hub, 0, 5)) return `${label} Hub Port`;
        if (isPhidgetRtd(model)) {
            if (!PHIDGET_RTDS.some((value) => value === params[`${role}_rtd_type`])) return `${label} RTD Type`;
            if (!['2', '3', '4'].includes(params[`${role}_rtd_wire_setup`])) return `${label} RTD Wires`;
        } else if (!PHIDGET_THERMOCOUPLES.some((value) => value === params[`${role}_thermocouple_type`])) {
            return `${label} Thermocouple Type`;
        }
    }
    return null;
};

export const updatePhidgetParam = (
    params: Record<string, string>,
    key: string,
    value: string,
): Record<string, string> => {
    const updated = { ...params, [key]: value };
    if (key === 'bt_device_type' || key === 'et_device_type') {
        const role = key.startsWith('bt_') ? 'bt' : 'et';
        const channel = Number(updated[`channel_${role}`]);
        if (
            updated[`channel_${role}`] !== '' &&
            (!Number.isInteger(channel) || channel < 0 || channel > (isPhidgetRtd(value) ? 0 : 3))
        )
            updated[`channel_${role}`] = '0';
        if (value === '1048') updated[`${role}_hub_port`] = '';
    }
    return updated;
};
