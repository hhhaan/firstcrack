/** Client contract: schema field error and save_blend error mapping share these strings. */
export const BLEND_DUPLICATE_BEAN_MESSAGE = '같은 생두를 중복으로 선택할 수 없습니다';
export const BLEND_RATIO_SUM_MESSAGE = '구성 비율 합계가 100%여야 합니다';

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
