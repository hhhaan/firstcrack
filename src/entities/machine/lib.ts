import {
    CUSTOM_CONNECT_KEYS,
    flattenAddressMaps,
    nestAddressMaps,
    PROTOCOLS_WITH_ADDRESS_MAP,
    validateAddressMaps,
} from './addressMap';
import { PROTOCOL_FORM_FIELDS } from './roasterRegistry';
import type { Machine, MachineSnapshot, RoasterDef, SidecarStatus } from './types';

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

/** Show and persist use the same plan gate. Only custom S7 adapters honor client write_map. */
export const writeMapFormFlags = (input: {
    isCustom: boolean;
    protocol: string;
    canConfigureControl: boolean;
}): { showWriteMap: boolean; includeWriteMap: boolean } => {
    const showWriteMap = input.isCustom && input.protocol === 's7' && input.canConfigureControl;
    return { showWriteMap, includeWriteMap: showWriteMap };
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
    isCustom = false,
): Record<string, string> => {
    const initial: Record<string, string> = {};
    for (const field of def.form_fields) {
        const val = existing?.[field.key] ?? def.default_params[field.key];
        initial[field.key] = val != null ? String(val) : '';
    }
    if (isCustom && PROTOCOLS_WITH_ADDRESS_MAP.has(def.protocol)) {
        Object.assign(initial, flattenAddressMaps(def.protocol, existing));
    }
    return initial;
};

export const buildTypedConnectionParams = (
    def: RoasterDef,
    stringParams: Record<string, string>,
    isCustom = false,
): Record<string, unknown> => {
    const mode = stringParams.mode;
    const result: Record<string, unknown> = {};
    for (const field of def.form_fields) {
        if (!isRoasterFieldVisible(field.key, mode)) continue;
        const raw = stringParams[field.key];
        if (raw === '' || raw == null) continue;
        result[field.key] = field.type === 'number' ? Number(raw) : raw;
    }
    if (isCustom && PROTOCOLS_WITH_ADDRESS_MAP.has(def.protocol)) {
        Object.assign(result, nestAddressMaps(def.protocol, stringParams));
    }
    return result;
};

/** Returns the first missing field key, or null if valid. */
export const validateRoasterFormFields = (
    def: RoasterDef,
    stringParams: Record<string, string>,
    isCustom = false,
): string | null => {
    const mode = stringParams.mode;
    for (const field of def.form_fields) {
        if (!isRoasterFieldVisible(field.key, mode)) continue;
        if (field.required && !stringParams[field.key]?.trim()) {
            return field.key;
        }
    }
    if (isCustom && PROTOCOLS_WITH_ADDRESS_MAP.has(def.protocol)) {
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

export const EMPTY_MACHINE_SNAPSHOT: MachineSnapshot = {
    machine_id: null,
    machine_name: null,
    machine_roaster_key: null,
    machine_brand: null,
    machine_protocol: null,
};

export const copyMachineSnapshot = (src: Partial<MachineSnapshot> | null | undefined): MachineSnapshot => ({
    machine_id: src?.machine_id ?? null,
    machine_name: src?.machine_name ?? null,
    machine_roaster_key: src?.machine_roaster_key ?? null,
    machine_brand: src?.machine_brand ?? null,
    machine_protocol: src?.machine_protocol ?? null,
});

type SidecarSnapshotSource = {
    connected?: boolean;
    roaster?: string | null;
    display_name?: string | null;
    brand?: string | null;
};

/** Connected sidecar + local machine list → durable snapshot. Null if not connected. */
export const snapshotFromSidecar = (
    status: SidecarSnapshotSource | null | undefined,
    machines: Machine[],
): MachineSnapshot | null => {
    if (!status?.connected || !status.roaster) return null;
    const machine = machines.find((m) => m.roasterKey === status.roaster);
    const name = machine?.name || machine?.displayName || status.display_name || status.roaster;
    return {
        machine_id: machine?.id ?? null,
        machine_name: name.trim() || null,
        machine_roaster_key: status.roaster,
        machine_brand: machine?.brand || status.brand || null,
        machine_protocol: machine?.protocol ?? null,
    };
};
