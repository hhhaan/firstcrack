import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { profileSourceCandidates, useProfileSourceHistory, useRoastProfiles } from '@entities/roast-profile';
import { useMemo } from 'react';

export const useRoastSourceCandidates = (ownerId: string, profileId: string | null) => {
    const beans = useBeans(ownerId);
    const blends = useBlends(ownerId);
    const profiles = useRoastProfiles(ownerId);
    const history = useProfileSourceHistory(ownerId, profileId);
    const candidates = useMemo(
        () =>
            profileSourceCandidates(
                profiles.data?.find((p) => p.id === profileId) ?? null,
                history.data ?? [],
                beans.data ?? [],
                blends.data ?? [],
            ),
        [profiles.data, profileId, history.data, beans.data, blends.data],
    );
    const inventoryOn = !!ownerId;
    return {
        candidates,
        ready:
            (!inventoryOn || (!beans.isPending && !blends.isPending && !profiles.isPending)) &&
            (!inventoryOn || !profileId || !history.isPending),
    };
};
