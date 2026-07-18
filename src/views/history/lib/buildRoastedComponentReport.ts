export type ComponentRow = {
    beanId: string;
    beanName: string;
    greenUsedG: number;
    roastedInG: number;
    /** null = 기간 내 green 사용 없음(집계 불가) */
    lossPct: number | null;
    hasEstimate: boolean;
};

/** 기간 × 생두: 투입/배출/실측 감량률. blend_produce 등 bean 귀속 불가 이벤트는 제외. 순수. */
export const buildRoastedComponentReport = (
    roastDeductions: { bean_id: string; delta_grams: number }[],
    roastedEvents: {
        bean_id: string | null;
        blend_id: string | null;
        delta_grams: number;
        event_type: string;
        is_estimate: boolean;
    }[],
    beanNames: Record<string, string>,
): ComponentRow[] => {
    const byBean = new Map<string, { green: number; roasted: number; est: boolean }>();
    const bucket = (id: string) => {
        let b = byBean.get(id);
        if (!b) {
            b = { green: 0, roasted: 0, est: false };
            byBean.set(id, b);
        }
        return b;
    };

    for (const d of roastDeductions) bucket(d.bean_id).green += Math.abs(d.delta_grams);
    for (const e of roastedEvents) {
        if (e.event_type !== 'roast_inbound' || !e.bean_id) continue;
        const b = bucket(e.bean_id);
        b.roasted += e.delta_grams;
        b.est ||= e.is_estimate;
    }

    return [...byBean.entries()]
        .map(([beanId, b]) => ({
            beanId,
            beanName: beanNames[beanId] ?? beanId,
            greenUsedG: b.green,
            roastedInG: b.roasted,
            lossPct: b.green > 0 ? Math.round(((b.green - b.roasted) / b.green) * 1000) / 10 : null,
            hasEstimate: b.est,
        }))
        .sort((a, b) => b.greenUsedG - a.greenUsedG);
};
