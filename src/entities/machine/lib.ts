import {
    addressDefaultsForProtocol,
    CUSTOM_CONNECT_KEYS,
    flattenAddressMaps,
    nestAddressMaps,
    PROTOCOLS_WITH_ADDRESS_MAP,
    validateAddressMaps,
} from './addressMap';
import { PROTOCOL_FORM_FIELDS } from './roasterRegistry';
import type { ControlCapability, RoasterDef, SidecarStatus } from './types';

export {
    addressDefaultsForProtocol,
    addressFormFieldsForProtocol,
    CUSTOM_CONNECT_KEYS,
    flattenAddressMaps,
    isCustomConnectKey,
    nestAddressMaps,
    PROTOCOLS_WITH_ADDRESS_MAP,
    validateAddressMaps,
} from './addressMap';

export const CUSTOM_ROASTER_KEY = '__custom__';

/** Protocols whose adapters honor a client-supplied write_map. */
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

/** Writable roles from persisted write_map keys. Read channels are not writable. */
export const controlCapabilitiesFromParams = (params: Record<string, unknown>): string[] => {
    const writeMap = params.write_map;
    if (!writeMap || typeof writeMap !== 'object' || Array.isArray(writeMap)) return [];
    return CONTROL_ROLES.filter((role) => role in writeMap);
};

export const writeRolesFromControl = (control?: ControlCapability | null): string[] => {
    if (!control) return [];
    const limits = control.limits;
    if (!limits || typeof limits !== 'object') return [];
    return CONTROL_ROLES.filter((role) => limits[role] != null);
};

/** Live /status.control wins; never fall back to registry `capabilities`. */
export const writeRolesFromStatus = (status: { control?: ControlCapability | null } | null | undefined): string[] =>
    writeRolesFromControl(status?.control);

export const writeDisplayRoles = (params: Record<string, unknown>, control?: ControlCapability | null): string[] => {
    const live = writeRolesFromControl(control);
    if (live.length > 0) return live;
    return controlCapabilitiesFromParams(params);
};

export const TCP_ONLY_FIELDS = new Set(['host', 'port']);
export const RTU_ONLY_FIELDS = new Set(['comport', 'baudrate', 'bytesize', 'parity', 'stopbits']);

/** Sidecar `GET /scan-network?protocol=` key for a machine protocol, or null if N/A. */
export const networkScanProtocol = (protocol: string): string | null => {
    switch (protocol) {
        case 's7':
        case 'kaleido':
        case 'probat_ws':
            return protocol;
        case 'modbus':
            return 'modbus_tcp';
        default:
            return null;
    }
};

export const isRoasterFieldVisible = (fieldKey: string, mode: string | undefined): boolean => {
    const normalized = mode?.toLowerCase() ?? '';
    if (!normalized) return true;
    const isTCP = normalized === 'tcp' || normalized === 'udp';
    const isRTU = normalized === 'rtu' || normalized === 'ascii' || normalized === 'serial';
    if (TCP_ONLY_FIELDS.has(fieldKey) && isRTU) return false;
    if (RTU_ONLY_FIELDS.has(fieldKey) && isTCP) return false;
    return true;
};

export const initRoasterFormParams = (
    def: RoasterDef,
    existing?: Record<string, unknown>,
    options?: { includeAddressMap?: boolean },
): Record<string, string> => {
    const initial: Record<string, string> = {};
    for (const field of def.form_fields) {
        const val = existing?.[field.key] ?? def.default_params[field.key];
        initial[field.key] = val != null ? String(val) : '';
    }
    if (options?.includeAddressMap && PROTOCOLS_WITH_ADDRESS_MAP.has(def.protocol)) {
        Object.assign(initial, flattenAddressMaps(def.protocol, existing));
        // Defaults when no stored map yet
        if (!existing?.modbus_registers && !existing?.channels) {
            Object.assign(initial, addressDefaultsForProtocol(def.protocol));
        }
    }
    return initial;
};

export const buildTypedConnectionParams = (
    def: RoasterDef,
    stringParams: Record<string, string>,
    options?: { includeAddressMap?: boolean },
): Record<string, unknown> => {
    const mode = stringParams.mode;
    const result: Record<string, unknown> = {};
    for (const field of def.form_fields) {
        if (!isRoasterFieldVisible(field.key, mode)) continue;
        const raw = stringParams[field.key];
        if (raw === '' || raw == null) continue;
        result[field.key] = field.type === 'number' ? Number(raw) : raw;
    }
    if (options?.includeAddressMap && PROTOCOLS_WITH_ADDRESS_MAP.has(def.protocol)) {
        Object.assign(result, nestAddressMaps(def.protocol, stringParams));
    }
    return result;
};

export const validateRoasterFormFields = (
    def: RoasterDef,
    stringParams: Record<string, string>,
    options?: { includeAddressMap?: boolean },
): string | null => {
    const mode = stringParams.mode;
    for (const field of def.form_fields) {
        if (!isRoasterFieldVisible(field.key, mode)) continue;
        if (field.required && !stringParams[field.key]?.trim()) {
            return field.label;
        }
    }
    if (options?.includeAddressMap && PROTOCOLS_WITH_ADDRESS_MAP.has(def.protocol)) {
        return validateAddressMaps(def.protocol, stringParams);
    }
    return null;
};

export const groupRoastersByBrand = (
    registry: Record<string, RoasterDef>,
): Record<string, { key: string; def: RoasterDef }[]> => {
    const brands: Record<string, { key: string; def: RoasterDef }[]> = {};
    for (const [key, def] of Object.entries(registry)) {
        if (def.brand === 'Internal') continue;
        if (key.startsWith('custom_')) continue;
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
    for (const [key, def] of Object.entries(registry)) {
        if (def.brand === 'Internal') continue;
        if (key.startsWith('custom_')) continue;
        set.add(def.protocol);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
};

/** Synthetic RoasterDef for custom mode: connection form fields only. */
export const buildProtocolRoasterDef = (protocol: string): RoasterDef => ({
    display_name: 'Custom',
    brand: 'Custom',
    models: [],
    protocol,
    capabilities: [],
    pid: null,
    form_fields: PROTOCOL_FORM_FIELDS[protocol] ?? [],
    default_params: {},
});

export const resolveCustomConnectKey = (protocol: string): string | null => CUSTOM_CONNECT_KEYS[protocol] ?? null;

export const isSameSidecarStatus = (prev: SidecarStatus | null, next: SidecarStatus): boolean =>
    prev?.connected === next.connected &&
    prev?.roaster === next.roaster &&
    prev?.error === next.error &&
    prev?.reconnecting === next.reconnecting;
