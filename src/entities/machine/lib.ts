import type { RoasterDef, SidecarStatus } from './types';

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

export const isSameSidecarStatus = (prev: SidecarStatus | null, next: SidecarStatus): boolean =>
    prev?.connected === next.connected &&
    prev?.roaster === next.roaster &&
    prev?.error === next.error &&
    prev?.reconnecting === next.reconnecting;
