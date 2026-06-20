export type BlendRatioComponent = { ratio_pct: number };

export type BlendNamedComponent = BlendRatioComponent & {
    beans: { name: string };
    id?: string;
};

export type BlendSegmentSource = {
    ratioPct: number;
    label: string;
    id?: string;
};

export const blendTotalRatio = (components: BlendRatioComponent[]): number =>
    components.reduce((sum, c) => sum + (Number(c.ratio_pct) || 0), 0);

export const blendSegmentsFromComponents = (components: BlendNamedComponent[]): BlendSegmentSource[] =>
    components.map((c) => ({
        ratioPct: Number(c.ratio_pct),
        label: c.beans.name,
        id: c.id,
    }));
