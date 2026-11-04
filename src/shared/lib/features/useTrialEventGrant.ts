import { fetchTrialEventGrant } from '@shared/lib/profile';
import { trialEventKeys } from '@shared/lib/query-keys';
import { useQuery } from '@tanstack/react-query';

export function useTrialEventGrant(ownerId: string, enabled = true) {
    return useQuery({
        queryKey: trialEventKeys.grant(ownerId),
        queryFn: () => fetchTrialEventGrant(ownerId),
        enabled: enabled && !!ownerId,
    });
}
