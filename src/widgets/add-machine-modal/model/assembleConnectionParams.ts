import type { RoasterDef } from '@entities/machine';
import { buildTypedConnectionParams, invalidSupportedAddressField, validateRoasterFormFields } from '@entities/machine';

/** Drop write_map unless the same plan gate that would show the form is on. */
export const persistConnectionParams = (
    typed: Record<string, unknown>,
    includeWriteMap: boolean,
): Record<string, unknown> => {
    if (includeWriteMap || !('write_map' in typed)) return typed;
    const rest = { ...typed };
    delete rest.write_map;
    return rest;
};

/** Validate form fields and build typed connection params. Returns missing field label on failure. */
export const assembleConnectionParams = (
    selectedDef: RoasterDef,
    params: Record<string, string>,
    showAddressMap: boolean,
    includeWriteMap: boolean,
    existing?: Record<string, unknown>,
): { ok: true; typed: Record<string, unknown> } | { ok: false; missing?: string; invalid?: string } => {
    const missing = validateRoasterFormFields(selectedDef, params, {
        includeAddressMap: showAddressMap,
    });
    if (missing) return { ok: false, missing };
    if (!showAddressMap) {
        const invalid = invalidSupportedAddressField(selectedDef.protocol, params);
        if (invalid) return { ok: false, invalid };
    }
    const typed = buildTypedConnectionParams(selectedDef, params, { includeAddressMap: showAddressMap });
    // The temperature form must not discard imported feedback addresses or their units.
    if (showAddressMap && selectedDef.protocol === 'modbus' && existing?.modbus_registers) {
        typed.modbus_registers = {
            ...(existing.modbus_registers as Record<string, unknown>),
            ...(typed.modbus_registers as Record<string, unknown>),
        };
    }
    if (showAddressMap && selectedDef.protocol === 's7' && Array.isArray(existing?.channels)) {
        typed.channels = [
            ...(typed.channels as Record<string, unknown>[]),
            ...existing.channels.filter((channel) => channel?.role !== 'BT' && channel?.role !== 'ET'),
        ];
    }
    return { ok: true, typed: persistConnectionParams(typed, includeWriteMap) };
};
