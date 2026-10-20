import type { RoastingRequirements } from '@entities/order';

export type BeanRequirementRow = RoastingRequirements['beans'][number];

export type AggregatedBeanRequirement = {
    bean_id: string;
    green_grams_needed: number;
    green_available: number;
    profiles: { roast_profile_id: string | null; green_grams_needed: number }[];
};

/** Sum green demand per bean; preserve per-profile breakdown for callers. */
export function aggregateBeanRequirements(rows: BeanRequirementRow[]): AggregatedBeanRequirement[] {
    const out: AggregatedBeanRequirement[] = [];
    const indexByBean = new Map<string, number>();

    for (const row of rows) {
        if (row.green_grams_needed <= 0) continue;

        const existing = indexByBean.get(row.bean_id);
        if (existing === undefined) {
            indexByBean.set(row.bean_id, out.length);
            out.push({
                bean_id: row.bean_id,
                green_grams_needed: row.green_grams_needed,
                green_available: row.green_available,
                profiles: [{ roast_profile_id: row.roast_profile_id, green_grams_needed: row.green_grams_needed }],
            });
            continue;
        }

        const agg = out[existing];
        agg.green_grams_needed += row.green_grams_needed;
        agg.profiles.push({
            roast_profile_id: row.roast_profile_id,
            green_grams_needed: row.green_grams_needed,
        });
    }

    return out;
}
