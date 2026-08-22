import type { RoasterDef } from '@entities/machine';
import { buildTypedConnectionParams, validateRoasterFormFields } from '@entities/machine';

/** Validate form fields and build typed connection params. Returns missing field label on failure. */
export const assembleConnectionParams = (
    selectedDef: RoasterDef,
    params: Record<string, string>,
    showAddressMap: boolean,
    includeWriteMap = false,
): { ok: true; typed: Record<string, unknown> } | { ok: false; missing: string } => {
    const missing = validateRoasterFormFields(selectedDef, params, {
        includeAddressMap: showAddressMap,
        includeWriteMap,
    });
    if (missing) return { ok: false, missing };
    return {
        ok: true,
        typed: buildTypedConnectionParams(selectedDef, params, {
            includeAddressMap: showAddressMap,
            includeWriteMap,
        }),
    };
};
