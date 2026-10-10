import { fetchProfile } from '@shared/lib/profile';
import { profileKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useQuery } from '@tanstack/react-query';

/** Logged-in account plan (`profiles.plan`), not the active workspace host plan. */
export function useAccountPlan(): string {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: plan = '' } = useQuery({
        queryKey: profileKeys.detail(userId),
        queryFn: () => fetchProfile(userId),
        enabled: !!userId,
        select: (row) => row?.plan ?? '',
    });
    return plan;
}
