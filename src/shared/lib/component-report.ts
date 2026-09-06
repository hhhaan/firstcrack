export type ComponentReportSession = {
    bean_id: string | null;
    bean_label: string | null;
    weight_grams: number;
    output_weight_grams: number | null;
    beans: { name: string } | null;
};

export type ComponentReportRow = {
    key: string;
    beanId: string | null;
    beanName: string;
    sessionCount: number;
    greenGrams: number;
    outputGrams: number;
};

/** Period × bean SUM of roast green (and measured output when present). */
export const aggregateComponentReport = (sessions: ComponentReportSession[]): ComponentReportRow[] => {
    const map = new Map<string, ComponentReportRow>();
    for (const s of sessions) {
        const key = s.bean_id ?? `label:${s.bean_label ?? ''}`;
        const existing = map.get(key);
        if (existing) {
            existing.sessionCount += 1;
            existing.greenGrams += s.weight_grams;
            existing.outputGrams += s.output_weight_grams ?? 0;
            continue;
        }
        map.set(key, {
            key,
            beanId: s.bean_id,
            beanName: s.beans?.name ?? s.bean_label ?? '—',
            sessionCount: 1,
            greenGrams: s.weight_grams,
            outputGrams: s.output_weight_grams ?? 0,
        });
    }
    return [...map.values()].sort((a, b) => b.greenGrams - a.greenGrams || a.beanName.localeCompare(b.beanName));
};
