import { fetchProfile } from '@shared/lib/profile';
import { profileKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useWorkspaceStore } from '@shared/store/workspace';
import { useQuery } from '@tanstack/react-query';
import { PERSONAL_PLAN_PLACEHOLDER, resolveEffectivePlan } from './effective-plan';
import type { FeatureKey } from './keys';

/**
 * Plan the server would apply to writes in the active workspace.
 * Personal plan: profiles RQ (`profileKeys`, same cache as `useProfile`).
 * Foreign workspace: host plan from `ownerPlanById`.
 */
export function useEffectivePlan(featureKey?: FeatureKey): string {
    const authUserId = useAuthStore((s) => s.user?.id ?? '');
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const ownerPlanById = useWorkspaceStore((s) => s.ownerPlanById);
    const { data: personalPlan = PERSONAL_PLAN_PLACEHOLDER } = useQuery({
        queryKey: profileKeys.detail(authUserId),
        queryFn: () => fetchProfile(authUserId),
        enabled: !!authUserId,
        select: (row) => row?.plan || PERSONAL_PLAN_PLACEHOLDER,
    });

    return resolveEffectivePlan({ personalPlan, authUserId, activeOwnerId, ownerPlanById, featureKey });
}
