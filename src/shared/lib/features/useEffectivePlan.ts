import { useAuthStore } from '@shared/store/auth';
import { useWorkspaceStore } from '@shared/store/workspace';
import { resolveEffectivePlan } from './effective-plan';
import type { FeatureKey } from './keys';

/**
 * Plan the server would apply to writes in the active workspace.
 * The batch gate reads `profiles.plan` of the session owner, so gates that pair
 * a plan with owner-scoped counts must resolve it this way, not from `auth.plan`.
 */
export function useEffectivePlan(featureKey?: FeatureKey): string {
    const personalPlan = useAuthStore((s) => s.plan);
    const authUserId = useAuthStore((s) => s.user?.id ?? '');
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const ownerPlanById = useWorkspaceStore((s) => s.ownerPlanById);

    return resolveEffectivePlan({ personalPlan, authUserId, activeOwnerId, ownerPlanById, featureKey });
}
