export type BeanMeta = {
    name: string | null;
    origin: string | null;
    region: string | null;
    variety: string | null;
    process: string | null;
    farm: string | null;
};

function strOrNull(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
}

/**
 * PostgREST many-to-one embed is an object at runtime; supabase-js types the
 * same `beans(...)` select as an array. Accept either.
 */
export function beanMetaFromJoin(beans: unknown): BeanMeta | null {
    const row = Array.isArray(beans) ? beans[0] : beans;
    if (!row || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    return {
        name: strOrNull(o.name),
        origin: strOrNull(o.origin),
        region: strOrNull(o.region),
        variety: strOrNull(o.variety),
        process: strOrNull(o.process),
        farm: strOrNull(o.farm),
    };
}

/** origin · region · variety · process · farm */
export function beanMetaLine(b: BeanMeta | null | undefined): string | null {
    if (!b) return null;
    const line = [b.origin, b.region, b.variety, b.process, b.farm].filter(Boolean).join(' · ');
    return line || null;
}
