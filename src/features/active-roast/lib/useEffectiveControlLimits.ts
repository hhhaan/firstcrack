import { useState } from 'react';
import { type ControlLimits, resolveEffectiveControlLimits, type StickyControlLimitsCache } from './control-channels';

export const useEffectiveControlLimits = (input: {
    machineId: string | null | undefined;
    roasterKey: string | null | undefined;
    statusLimits: ControlLimits;
    statusLimitsReceived: boolean;
    useStickyPresentation: boolean;
}): ControlLimits | undefined => {
    const identity = input.machineId?.trim() || input.roasterKey?.trim() || null;
    const [cache, setCache] = useState<StickyControlLimitsCache>(null);
    const resolved = resolveEffectiveControlLimits({
        cache,
        identity,
        statusLimits: input.statusLimits,
        statusLimitsReceived: input.statusLimitsReceived,
        useStickyPresentation: input.useStickyPresentation,
    });
    if (resolved.cache !== cache) {
        setCache(resolved.cache);
    }
    return resolved.limits;
};
