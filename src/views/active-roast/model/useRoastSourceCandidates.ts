import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import {
    profileSourceCandidates,
    registeredProfileSourceCandidates,
    useProfileSourceHistory,
    useRoastProfiles,
} from '@entities/roast-profile';
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
    const registeredCandidates = useMemo(
        () =>
            registeredProfileSourceCandidates(
                profiles.data?.find((p) => p.id === profileId) ?? null,
                beans.data ?? [],
                blends.data ?? [],
            ),
        [profiles.data, profileId, beans.data, blends.data],
    );
    return {
        candidates,
        registeredSources: {
            profileId,
            workspaceOwnerId: ownerId,
            candidates: registeredCandidates,
            ready: Boolean(ownerId) && beans.isSuccess && blends.isSuccess && profiles.isSuccess,
        },
        ready: beans.isSuccess && blends.isSuccess && profiles.isSuccess && (!profileId || history.isSuccess),
    };
};
