import { DIV_OPTIONS, S7_TYPE_OPTIONS } from './addressMap';
import type { RoasterFormField } from './types';

/** Protocols whose adapters actually honor a client-supplied write_map. */
export const PROTOCOLS_WITH_WRITE_MAP = new Set(['s7']);

export const CONTROL_ROLES = ['heater', 'fan', 'drum'] as const;
export type ControlRole = (typeof CONTROL_ROLES)[number];

/** Show and persist use the same plan/protocol gate — never persist a hidden write map. */
export const writeMapFormFlags = (input: {
    isCustom: boolean;
    protocol: string;
    canConfigureControl: boolean;
}): { showWriteMap: boolean; includeWriteMap: boolean } => {
    const showWriteMap = input.isCustom && PROTOCOLS_WITH_WRITE_MAP.has(input.protocol) && input.canConfigureControl;
    return { showWriteMap, includeWriteMap: showWriteMap };
};

const ROLE_LABEL: Record<ControlRole, string> = {
    heater: 'Heater',
    fan: 'Fan',
    drum: 'Drum',
};

const asNum = (v: string | undefined, fallback = 0): number => {
    if (v == null || v.trim() === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const filled = (v: string | undefined): boolean => v != null && v.trim() !== '';

const isControlRole = (role: unknown): role is ControlRole =>
    typeof role === 'string' && (CONTROL_ROLES as readonly string[]).includes(role);

const s7WriteFields = (role: ControlRole): RoasterFormField[] => {
    const label = ROLE_LABEL[role];
    return [
        {
            key: `${role}_w_db`,
            label: `${label} write DB (empty = off)`,
            type: 'number',
            required: false,
            placeholder: 'optional',
        },
        { key: `${role}_w_offset`, label: `${label} write offset`, type: 'number', required: false, placeholder: '0' },
        {
            key: `${role}_w_type`,
            label: `${label} write type`,
            type: 'select',
            required: false,
            options: S7_TYPE_OPTIONS,
        },
        {
            key: `${role}_w_div`,
            label: `${label} write scale`,
            type: 'select',
            required: false,
            options: DIV_OPTIONS,
        },
        { key: `${role}_w_min`, label: `${label} write min`, type: 'number', required: false, placeholder: '0' },
        { key: `${role}_w_max`, label: `${label} write max`, type: 'number', required: false, placeholder: '100' },
    ];
};

const s7ReadFields = (role: ControlRole): RoasterFormField[] => {
    const label = ROLE_LABEL[role];
    return [
        {
            key: `${role}_r_db`,
            label: `${label} read DB (empty = off)`,
            type: 'number',
            required: false,
            placeholder: 'optional',
        },
        { key: `${role}_r_offset`, label: `${label} read offset`, type: 'number', required: false, placeholder: '0' },
        {
            key: `${role}_r_type`,
            label: `${label} read type`,
            type: 'select',
            required: false,
            options: S7_TYPE_OPTIONS,
        },
        {
            key: `${role}_r_div`,
            label: `${label} read scale`,
            type: 'select',
            required: false,
            options: DIV_OPTIONS,
        },
    ];
};

export const PID_FORM_FIELDS: RoasterFormField[] = [
    { key: 'pid_kp', label: 'PID Kp', type: 'number', required: false, placeholder: '20', step: 'any' },
    { key: 'pid_ki', label: 'PID Ki', type: 'number', required: false, placeholder: '0.01', step: 'any' },
    { key: 'pid_kd', label: 'PID Kd', type: 'number', required: false, placeholder: '3', step: 'any' },
];

export const writeFieldsForRole = (protocol: string, role: ControlRole): RoasterFormField[] => {
    if (protocol !== 's7') return [];
    return s7WriteFields(role);
};

export const readFieldsForRole = (protocol: string, role: ControlRole): RoasterFormField[] => {
    if (protocol !== 's7') return [];
    return s7ReadFields(role);
};

const s7RoleDefaults = (role: ControlRole): Record<string, string> => ({
    [`${role}_w_db`]: '',
    [`${role}_w_offset`]: '0',
    [`${role}_w_type`]: '0',
    [`${role}_w_div`]: '0',
    [`${role}_w_min`]: '0',
    [`${role}_w_max`]: '100',
    [`${role}_r_db`]: '',
    [`${role}_r_offset`]: '0',
    [`${role}_r_type`]: '0',
    [`${role}_r_div`]: '0',
});

export const writeMapDefaultsForProtocol = (protocol: string): Record<string, string> => {
    if (protocol !== 's7') return {};
    return {
        ...CONTROL_ROLES.reduce<Record<string, string>>((acc, role) => Object.assign(acc, s7RoleDefaults(role)), {}),
        pid_kp: '',
        pid_ki: '',
        pid_kd: '',
    };
};

type S7Channel = { role: string; db: number; offset: number; area: number; type: number; div: number };

const buildS7WriteSpec = (p: Record<string, string>, role: ControlRole): Record<string, unknown> | null => {
    if (!filled(p[`${role}_w_db`])) return null;
    return {
        db: asNum(p[`${role}_w_db`], 0),
        offset: asNum(p[`${role}_w_offset`], 0),
        area: 6,
        type: asNum(p[`${role}_w_type`], 0),
        div: asNum(p[`${role}_w_div`], 0),
        min: asNum(p[`${role}_w_min`], 0),
        max: asNum(p[`${role}_w_max`], 100),
        unit: '%',
    };
};

const buildS7ReadChannel = (p: Record<string, string>, role: ControlRole): S7Channel | null => {
    if (!filled(p[`${role}_r_db`])) return null;
    return {
        role,
        db: asNum(p[`${role}_r_db`], 0),
        offset: asNum(p[`${role}_r_offset`], 0),
        area: 6,
        type: asNum(p[`${role}_r_type`], 0),
        div: asNum(p[`${role}_r_div`], 0),
    };
};

const buildPid = (p: Record<string, string>): { Kp: number; Ki: number; Kd: number } | null => {
    if (!filled(p.pid_kp) && !filled(p.pid_ki) && !filled(p.pid_kd)) return null;
    if (!filled(p.pid_kp) || !filled(p.pid_ki) || !filled(p.pid_kd)) return null;
    const Kp = Number(p.pid_kp);
    const Ki = Number(p.pid_ki);
    const Kd = Number(p.pid_kd);
    if (![Kp, Ki, Kd].every((n) => Number.isFinite(n))) return null;
    return { Kp, Ki, Kd };
};

/** Nest flat control form values into sidecar connect params (write_map / pid / extra channels). */
export const nestWriteMaps = (protocol: string, stringParams: Record<string, string>): Record<string, unknown> => {
    if (protocol !== 's7') return {};

    const write_map: Record<string, unknown> = {};
    for (const role of CONTROL_ROLES) {
        const spec = buildS7WriteSpec(stringParams, role);
        if (spec) write_map[role] = spec;
    }

    const extraChannels: S7Channel[] = [];
    for (const role of CONTROL_ROLES) {
        const ch = buildS7ReadChannel(stringParams, role);
        if (ch) extraChannels.push(ch);
    }

    const pid = buildPid(stringParams);
    const out: Record<string, unknown> = {};
    if (Object.keys(write_map).length > 0) out.write_map = write_map;
    if (extraChannels.length > 0) out.control_channels = extraChannels;
    if (pid) out.pid = pid;
    return out;
};

type StoredWriteSpec = {
    db?: number;
    offset?: number;
    type?: number;
    div?: number;
    min?: number;
    max?: number;
};

/** Flatten stored write_map / pid / heater-fan-drum channels into form strings. */
export const flattenWriteMaps = (protocol: string, existing?: Record<string, unknown>): Record<string, string> => {
    const base = writeMapDefaultsForProtocol(protocol);
    if (!existing || protocol !== 's7') return base;

    const writeMap = existing.write_map as Partial<Record<ControlRole, StoredWriteSpec>> | undefined;
    for (const role of CONTROL_ROLES) {
        const spec = writeMap?.[role];
        if (!spec) continue;
        base[`${role}_w_db`] = String(spec.db ?? 0);
        base[`${role}_w_offset`] = String(spec.offset ?? 0);
        base[`${role}_w_type`] = String(spec.type ?? 0);
        base[`${role}_w_div`] = String(spec.div ?? 0);
        base[`${role}_w_min`] = String(spec.min ?? 0);
        base[`${role}_w_max`] = String(spec.max ?? 100);
    }

    const channels = existing.channels as
        | { role: string; db: number; offset: number; type?: number; div?: number }[]
        | undefined;
    for (const role of CONTROL_ROLES) {
        const ch = channels?.find((c) => c.role === role);
        if (!ch) continue;
        base[`${role}_r_db`] = String(ch.db);
        base[`${role}_r_offset`] = String(ch.offset);
        base[`${role}_r_type`] = String(ch.type ?? 0);
        base[`${role}_r_div`] = String(ch.div ?? 0);
    }

    const pid = existing.pid as { Kp?: number; Ki?: number; Kd?: number } | null | undefined;
    if (pid && pid.Kp != null && pid.Ki != null && pid.Kd != null) {
        base.pid_kp = String(pid.Kp);
        base.pid_ki = String(pid.Ki);
        base.pid_kd = String(pid.Kd);
    }
    return base;
};

export const validateWriteMaps = (protocol: string, stringParams: Record<string, string>): string | null => {
    if (protocol !== 's7') return null;
    for (const role of CONTROL_ROLES) {
        const label = ROLE_LABEL[role];
        if (filled(stringParams[`${role}_w_db`]) && !filled(stringParams[`${role}_w_offset`])) {
            return `${label} write offset`;
        }
        if (filled(stringParams[`${role}_r_db`]) && !filled(stringParams[`${role}_r_offset`])) {
            return `${label} read offset`;
        }
    }
    const pidAny = filled(stringParams.pid_kp) || filled(stringParams.pid_ki) || filled(stringParams.pid_kd);
    if (pidAny) {
        for (const field of PID_FORM_FIELDS) {
            if (!filled(stringParams[field.key])) return field.label;
        }
        if (![stringParams.pid_kp, stringParams.pid_ki, stringParams.pid_kd].every((v) => Number.isFinite(Number(v)))) {
            return 'PID Kp';
        }
    }
    return null;
};

export const pidFromParams = (params: Record<string, unknown>): { Kp: number; Ki: number; Kd: number } | null => {
    const pid = params.pid;
    if (!pid || typeof pid !== 'object') return null;
    const { Kp, Ki, Kd } = pid as { Kp?: unknown; Ki?: unknown; Kd?: unknown };
    if (typeof Kp !== 'number' || typeof Ki !== 'number' || typeof Kd !== 'number') return null;
    if (![Kp, Ki, Kd].every((n) => Number.isFinite(n))) return null;
    return { Kp, Ki, Kd };
};

export const controlCapabilitiesFromParams = (params: Record<string, unknown>): string[] => {
    const roles = new Set<string>();
    const writeMap = params.write_map;
    if (writeMap && typeof writeMap === 'object') {
        for (const role of CONTROL_ROLES) {
            if (role in writeMap) roles.add(role);
        }
    }
    const channels = params.channels;
    if (Array.isArray(channels)) {
        for (const ch of channels) {
            if (ch && typeof ch === 'object' && 'role' in ch && isControlRole(ch.role)) {
                roles.add(ch.role);
            }
        }
    }
    return CONTROL_ROLES.filter((role) => roles.has(role));
};
