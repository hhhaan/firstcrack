import type { RoasterDef } from '@entities/machine';
import { buildTypedConnectionParams, validateRoasterFormFields } from '@entities/machine';

/** Drop write_map/pid unless the same plan gate that would show the form is on. */
export const persistConnectionParams = (
    typed: Record<string, unknown>,
    includeWriteMap: boolean,
): Record<string, unknown> => {
    if (includeWriteMap || (!('write_map' in typed) && !('pid' in typed))) return typed;
    const rest = { ...typed };
    delete rest.write_map;
    delete rest.pid;
    return rest;
};

/** Validate form fields and build typed connection params. Returns missing field label on failure. */
export const assembleConnectionParams = (
    selectedDef: RoasterDef,
    params: Record<string, string>,
    showAddressMap: boolean,
    includeWriteMap: boolean,
): { ok: true; typed: Record<string, unknown> } | { ok: false; missing: string } => {
    const missing = validateRoasterFormFields(selectedDef, params, {
        includeAddressMap: showAddressMap,
        includeWriteMap,
    });
    if (missing) return { ok: false, missing };
    return {
        ok: true,
        typed: persistConnectionParams(
            buildTypedConnectionParams(selectedDef, params, {
                includeAddressMap: showAddressMap,
                includeWriteMap,
            }),
            includeWriteMap,
        ),
    };
};
