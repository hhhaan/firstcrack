import type { RoasterFormField } from './types';

/** Sidecar connect keys for free-form custom machines (address maps from client params). */
export const CUSTOM_CONNECT_KEYS: Record<string, string> = {
    modbus: 'custom_modbus',
    s7: 'custom_s7',
    phidget: 'custom_phidget',
    kaleido: 'custom_kaleido',
    probat_ws: 'custom_probat_ws',
};

export const isCustomConnectKey = (key: string): boolean => key.startsWith('custom_');

export const PROTOCOLS_WITH_ADDRESS_MAP = new Set(['modbus', 's7']);

const FUNC_OPTIONS = [
    { value: '3', label: '3 Holding' },
    { value: '4', label: '4 Input' },
    { value: '1', label: '1 Coils' },
    { value: '2', label: '2 Discrete' },
];

export const DIV_OPTIONS = [
    { value: '0', label: 'raw (÷1)' },
    { value: '1', label: '÷10' },
    { value: '2', label: '÷100' },
];

const BOOL_OPTIONS = [
    { value: 'false', label: 'No' },
    { value: 'true', label: 'Yes' },
];

const TEMP_MODE_OPTIONS = [
    { value: 'C', label: '°C' },
    { value: 'F', label: '°F' },
];

export const S7_TYPE_OPTIONS = [
    { value: '0', label: 'INT (16-bit)' },
    { value: '1', label: 'REAL (float)' },
];

/** Flat form fields for custom modbus BT/ET register mapping. */
export const MODBUS_ADDRESS_FORM_FIELDS: RoasterFormField[] = [
    { key: 'bt_register', label: 'BT Register', type: 'number', required: true, placeholder: '0' },
    { key: 'bt_func', label: 'BT Function', type: 'select', required: true, options: FUNC_OPTIONS },
    { key: 'bt_unit_id', label: 'BT Unit ID', type: 'number', required: true, placeholder: '1' },
    { key: 'bt_float', label: 'BT 32-bit Float', type: 'select', required: true, options: BOOL_OPTIONS },
    { key: 'bt_div', label: 'BT Scale', type: 'select', required: true, options: DIV_OPTIONS },
    { key: 'bt_mode', label: 'BT Unit', type: 'select', required: true, options: TEMP_MODE_OPTIONS },
    {
        key: 'et_register',
        label: 'ET Register (empty = off)',
        type: 'number',
        required: false,
        placeholder: 'optional',
    },
    { key: 'et_func', label: 'ET Function', type: 'select', required: false, options: FUNC_OPTIONS },
    { key: 'et_unit_id', label: 'ET Unit ID', type: 'number', required: false, placeholder: '1' },
    { key: 'et_float', label: 'ET 32-bit Float', type: 'select', required: false, options: BOOL_OPTIONS },
    { key: 'et_div', label: 'ET Scale', type: 'select', required: false, options: DIV_OPTIONS },
    { key: 'et_mode', label: 'ET Unit', type: 'select', required: false, options: TEMP_MODE_OPTIONS },
    {
        key: 'word_order',
        label: 'Float Word Order',
        type: 'select',
        required: false,
        options: [
            { value: 'little', label: 'Little (low, high)' },
            { value: 'big', label: 'Big (high, low)' },
        ],
    },
];

/** Flat form fields for custom S7 BT/ET channel mapping. */
export const S7_ADDRESS_FORM_FIELDS: RoasterFormField[] = [
    { key: 'bt_db', label: 'BT DB', type: 'number', required: true, placeholder: '3' },
    { key: 'bt_offset', label: 'BT Offset', type: 'number', required: true, placeholder: '0' },
    { key: 'bt_type', label: 'BT Type', type: 'select', required: true, options: S7_TYPE_OPTIONS },
    { key: 'bt_div', label: 'BT Scale', type: 'select', required: true, options: DIV_OPTIONS },
    { key: 'et_db', label: 'ET DB (empty = off)', type: 'number', required: false, placeholder: 'optional' },
    { key: 'et_offset', label: 'ET Offset', type: 'number', required: false, placeholder: '0' },
    { key: 'et_type', label: 'ET Type', type: 'select', required: false, options: S7_TYPE_OPTIONS },
    { key: 'et_div', label: 'ET Scale', type: 'select', required: false, options: DIV_OPTIONS },
];

export const addressFormFieldsForProtocol = (protocol: string): RoasterFormField[] => {
    if (protocol === 'modbus') return MODBUS_ADDRESS_FORM_FIELDS;
    if (protocol === 's7') return S7_ADDRESS_FORM_FIELDS;
    return [];
};

const MODBUS_ADDRESS_DEFAULTS: Record<string, string> = {
    bt_register: '0',
    bt_func: '3',
    bt_unit_id: '1',
    bt_float: 'false',
    bt_div: '0',
    bt_mode: 'C',
    et_register: '',
    et_func: '3',
    et_unit_id: '1',
    et_float: 'false',
    et_div: '0',
    et_mode: 'C',
    word_order: 'little',
};

const S7_ADDRESS_DEFAULTS: Record<string, string> = {
    bt_db: '3',
    bt_offset: '0',
    bt_type: '0',
    bt_div: '0',
    et_db: '',
    et_offset: '0',
    et_type: '0',
    et_div: '0',
};

export const addressDefaultsForProtocol = (protocol: string): Record<string, string> => {
    if (protocol === 'modbus') return { ...MODBUS_ADDRESS_DEFAULTS };
    if (protocol === 's7') return { ...S7_ADDRESS_DEFAULTS };
    return {};
};

const asBool = (v: string | undefined): boolean => v === 'true' || v === '1';

const asNum = (v: string | undefined, fallback = 0): number => {
    if (v == null || v.trim() === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

type ModbusChannel = {
    register: number;
    func: number;
    unit_id: number;
    float: boolean;
    div: number;
    mode: string;
};

const buildModbusChannel = (p: Record<string, string>, prefix: 'bt' | 'et'): ModbusChannel | null => {
    const regRaw = p[`${prefix}_register`];
    if (prefix === 'et' && (regRaw == null || regRaw.trim() === '')) return null;
    if (prefix === 'bt' && (regRaw == null || regRaw.trim() === '')) return null;

    return {
        register: asNum(regRaw, 0),
        func: asNum(p[`${prefix}_func`], 3),
        unit_id: asNum(p[`${prefix}_unit_id`], 1),
        float: asBool(p[`${prefix}_float`]),
        div: asNum(p[`${prefix}_div`], 0),
        mode: p[`${prefix}_mode`] || 'C',
    };
};

/** Nest flat address form values into sidecar adapter params. */
export const nestAddressMaps = (protocol: string, stringParams: Record<string, string>): Record<string, unknown> => {
    if (protocol === 'modbus') {
        const bt = buildModbusChannel(stringParams, 'bt');
        if (!bt) return {};
        const et = buildModbusChannel(stringParams, 'et');
        const out: Record<string, unknown> = {
            modbus_registers: {
                BT: bt,
                ET: et,
            },
        };
        if (stringParams.word_order) out.word_order = stringParams.word_order;
        return out;
    }

    if (protocol === 's7') {
        const channels: Record<string, unknown>[] = [
            {
                role: 'BT',
                db: asNum(stringParams.bt_db, 3),
                offset: asNum(stringParams.bt_offset, 0),
                area: 6,
                type: asNum(stringParams.bt_type, 0),
                div: asNum(stringParams.bt_div, 0),
            },
        ];
        if (stringParams.et_db != null && stringParams.et_db.trim() !== '') {
            channels.push({
                role: 'ET',
                db: asNum(stringParams.et_db, 3),
                offset: asNum(stringParams.et_offset, 0),
                area: 6,
                type: asNum(stringParams.et_type, 0),
                div: asNum(stringParams.et_div, 0),
            });
        }
        return { channels };
    }

    return {};
};

/** Flatten nested maps from stored connectionParams into form string values. */
export const flattenAddressMaps = (protocol: string, existing?: Record<string, unknown>): Record<string, string> => {
    const base = addressDefaultsForProtocol(protocol);
    if (!existing) return base;

    if (protocol === 'modbus') {
        const regs = existing.modbus_registers as { BT?: ModbusChannel | null; ET?: ModbusChannel | null } | undefined;
        if (!regs?.BT) return base;
        const bt = regs.BT;
        const et = regs.ET;
        return {
            ...base,
            bt_register: String(bt.register),
            bt_func: String(bt.func ?? 3),
            bt_unit_id: String(bt.unit_id ?? 1),
            bt_float: String(Boolean(bt.float)),
            bt_div: String(bt.div ?? 0),
            bt_mode: bt.mode ?? 'C',
            et_register: et ? String(et.register) : '',
            et_func: String(et?.func ?? 3),
            et_unit_id: String(et?.unit_id ?? 1),
            et_float: String(Boolean(et?.float)),
            et_div: String(et?.div ?? 0),
            et_mode: et?.mode ?? 'C',
            word_order: String(existing.word_order ?? 'little'),
        };
    }

    if (protocol === 's7') {
        const channels = existing.channels as
            | { role: string; db: number; offset: number; type?: number; div?: number }[]
            | undefined;
        if (!channels?.length) return base;
        const bt = channels.find((c) => c.role === 'BT');
        const et = channels.find((c) => c.role === 'ET');
        return {
            ...base,
            bt_db: String(bt?.db ?? 3),
            bt_offset: String(bt?.offset ?? 0),
            bt_type: String(bt?.type ?? 0),
            bt_div: String(bt?.div ?? 0),
            et_db: et ? String(et.db) : '',
            et_offset: String(et?.offset ?? 0),
            et_type: String(et?.type ?? 0),
            et_div: String(et?.div ?? 0),
        };
    }

    return base;
};

/** Validate required address fields; returns label of first missing field or null. */
export const validateAddressMaps = (protocol: string, stringParams: Record<string, string>): string | null => {
    const fields = addressFormFieldsForProtocol(protocol);
    for (const field of fields) {
        if (!field.required) continue;
        if (!stringParams[field.key]?.trim()) return field.label;
    }
    return null;
};
