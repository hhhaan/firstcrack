export type ProfileSource = { bean_id: string | null; blend_id: string | null };
export type RoastSourceCandidate = { beanId: string | null; blendId: string | null; name: string };

type RegisteredProfile = { default_bean_id: string | null; default_blend_id: string | null; sources?: ProfileSource[] };

/** Older clients can still create profiles with only a singular default. */
export const registeredProfileSources = (profile: RegisteredProfile): ProfileSource[] => {
    const sources = [
        ...(profile.sources ?? []),
        ...(profile.default_bean_id ? [{ bean_id: profile.default_bean_id, blend_id: null }] : []),
        ...(profile.default_blend_id ? [{ bean_id: null, blend_id: profile.default_blend_id }] : []),
    ];
    return [
        ...new Map(
            sources.map((source) => [source.blend_id ? `blend:${source.blend_id}` : `bean:${source.bean_id}`, source]),
        ).values(),
    ];
};

/** Registered sources and actual use history, deduplicated by kind + inventory id. */
export const profileSourceCandidates = (
    profile: RegisteredProfile | null,
    history: ProfileSource[],
    beans: { id: string; name: string }[],
    blends: { id: string; name: string }[],
): RoastSourceCandidate[] => {
    if (!profile) return [];
    const sources = [...registeredProfileSources(profile), ...history];
    const beanById = new Map(beans.map((bean) => [bean.id, bean]));
    const blendById = new Map(blends.map((blend) => [blend.id, blend]));
    const unique = new Map<string, RoastSourceCandidate>();
    for (const source of sources) {
        const blend = source.blend_id ? blendById.get(source.blend_id) : null;
        const bean = !source.blend_id && source.bean_id ? beanById.get(source.bean_id) : null;
        if (blend) unique.set(`blend:${blend.id}`, { beanId: null, blendId: blend.id, name: blend.name });
        else if (bean) unique.set(`bean:${bean.id}`, { beanId: bean.id, blendId: null, name: bean.name });
    }
    return [...unique.values()];
};
