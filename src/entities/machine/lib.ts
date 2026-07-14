import { PROTOCOL_FORM_FIELDS } from './roasterRegistry';
import type { RoasterDef, SidecarStatus } from './types';

export const CUSTOM_ROASTER_KEY = '__custom__';

/** Protocols that need a registry template for address maps (modbus registers / S7 channels). */
export const PROTOCOLS_REQUIRING_TEMPLATE = new Set(['s7', 'modbus']);

export const TCP_ONLY_FIELDS = new Set(['host', 'port']);
export const RTU_ONLY_FIELDS = new Set(['comport', 'baudrate', 'bytesize', 'parity', 'stopbits']);

export const isRoasterFieldVisible = (fieldKey: string, mode: string | undefined): boolean => {
    const normalized = mode?.toLowerCase() ?? '';
    if (!normalized) return true;
    const isTCP = normalized === 'tcp' || normalized === 'udp';
    const isRTU = normalized === 'rtu' || normalized === 'serial';
    if (TCP_ONLY_FIELDS.has(fieldKey) && isRTU) return false;
    if (RTU_ONLY_FIELDS.has(fieldKey) && isTCP) return false;
    return true;
};

export const initRoasterFormParams = (def: RoasterDef, existing?: Record<string, unknown>): Record<string, string> => {
    const initial: Record<string, string> = {};
    for (const field of def.form_fields) {
        const val = existing?.[field.key] ?? def.default_params[field.key];
        initial[field.key] = val != null ? String(val) : '';
    }
    return initial;
};

export const buildTypedConnectionParams = (
    def: RoasterDef,
    stringParams: Record<string, string>,
): Record<string, unknown> => {
    const mode = stringParams.mode;
    const result: Record<string, unknown> = {};
    for (const field of def.form_fields) {
        if (!isRoasterFieldVisible(field.key, mode)) continue;
        const raw = stringParams[field.key];
        if (raw === '' || raw == null) continue;
        result[field.key] = field.type === 'number' ? Number(raw) : raw;
    }
    return result;
};

export const validateRoasterFormFields = (def: RoasterDef, stringParams: Record<string, string>): string | null => {
    const mode = stringParams.mode;
    for (const field of def.form_fields) {
        if (!isRoasterFieldVisible(field.key, mode)) continue;
        if (field.required && !stringParams[field.key]?.trim()) {
            return field.label;
        }
    }
    return null;
};

export const groupRoastersByBrand = (
    registry: Record<string, RoasterDef>,
): Record<string, { key: string; def: RoasterDef }[]> => {
    const brands: Record<string, { key: string; def: RoasterDef }[]> = {};
    for (const [key, def] of Object.entries(registry)) {
        if (def.brand === 'Internal') continue;
        if (!brands[def.brand]) brands[def.brand] = [];
        brands[def.brand].push({ key, def });
    }
    for (const items of Object.values(brands)) {
        items.sort((a, b) => a.def.display_name.localeCompare(b.def.display_name));
    }
    return brands;
};

/** Unique non-internal protocols present in the registry, sorted. */
export const listProtocols = (registry: Record<string, RoasterDef>): string[] => {
    const set = new Set<string>();
    for (const def of Object.values(registry)) {
        if (def.brand === 'Internal') continue;
        set.add(def.protocol);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
};

/** Registry entries that can drive a given protocol (templates for custom machines). */
export const listTemplatesByProtocol = (
    registry: Record<string, RoasterDef>,
    protocol: string,
): { key: string; def: RoasterDef }[] => {
    const items: { key: string; def: RoasterDef }[] = [];
    for (const [key, def] of Object.entries(registry)) {
        if (def.brand === 'Internal') continue;
        if (def.protocol !== protocol) continue;
        items.push({ key, def });
    }
    items.sort((a, b) => a.def.display_name.localeCompare(b.def.display_name));
    return items;
};

/** Synthetic RoasterDef for custom mode: protocol form fields + template defaults. */
export const buildProtocolRoasterDef = (protocol: string, template?: RoasterDef | null): RoasterDef => {
    const form_fields = PROTOCOL_FORM_FIELDS[protocol] ?? [];
    if (template) {
        return {
            ...template,
            form_fields: form_fields.length > 0 ? form_fields : template.form_fields,
        };
    }
    return {
        display_name: 'Custom',
        brand: 'Custom',
        models: [],
        protocol,
        capabilities: [],
        pid: null,
        form_fields,
        default_params: {},
    };
};

export const isSameSidecarStatus = (prev: SidecarStatus | null, next: SidecarStatus): boolean =>
    prev?.connected === next.connected &&
    prev?.roaster === next.roaster &&
    prev?.error === next.error &&
    prev?.reconnecting === next.reconnecting;
