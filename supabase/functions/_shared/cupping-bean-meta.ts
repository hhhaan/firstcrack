export type BeanMeta = {
    name: string | null;
    origin: string | null;
    region: string | null;
    variety: string | null;
    process: string | null;
    farm: string | null;
};

/** origin · region · variety · process · farm */
export function beanMetaLine(b: BeanMeta | null | undefined): string | null {
    if (!b) return null;
    const line = [b.origin, b.region, b.variety, b.process, b.farm].filter(Boolean).join(' · ');
    return line || null;
}
