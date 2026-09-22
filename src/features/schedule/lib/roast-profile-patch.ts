/**
 * Roast profile column for an update of an existing batch.
 * A blank control keeps the id already on the batch. If that id is also
 * missing, the column is omitted so a series master in the database is not
 * nulled. Explicit clear writes null.
 */
export function roastProfilePatch(
    submitted: string | null,
    existing: string | null | undefined,
    keepExisting: boolean,
): { roast_profile_id?: string | null } {
    if (submitted) return { roast_profile_id: submitted };
    if (!keepExisting) return { roast_profile_id: null };
    if (existing) return { roast_profile_id: existing };
    return {};
}
