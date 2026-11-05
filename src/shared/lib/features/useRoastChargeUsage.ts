import { fetchRoastChargeUsage } from '@shared/lib/profile';
import { roastChargeKeys } from '@shared/lib/query-keys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useExpiryClock } from './useExpiryClock';

export function useRoastChargeUsage(ownerId: string, plan: string, enabled = true) {
    const qc = useQueryClient();
    const query = useQuery({
        queryKey: roastChargeKeys.usage(ownerId, plan),
        queryFn: () => fetchRoastChargeUsage(ownerId),
        enabled: enabled && !!ownerId && !!plan,
    });
    const endsAt = query.data?.period_end;
    const now = useExpiryClock(endsAt);
    useEffect(() => {
        if (enabled && endsAt && now >= new Date(endsAt).getTime() && plan !== 'trial' && plan !== 'trial-event') {
            void qc.invalidateQueries({ queryKey: roastChargeKeys.usage(ownerId, plan) });
        }
    }, [enabled, endsAt, now, plan, ownerId, qc]);
    return query;
}
