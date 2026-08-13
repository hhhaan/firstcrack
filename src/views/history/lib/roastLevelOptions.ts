export const HISTORY_ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

/** Facet row used to build History filter dropdowns (not the current page). */
export type RoastLevelFacet = { roast_level: string | null };

/** Levels that exist in server filterMeta, in canonical order. Ignores the current page. */
export function buildRoastLevelFilterOptions(
    levels: readonly string[],
    facet: ReadonlyArray<RoastLevelFacet>,
): string[] {
    const present = new Set<string>();
    for (const row of facet) {
        if (row.roast_level) present.add(row.roast_level);
    }
    return levels.filter((level) => present.has(level));
}
