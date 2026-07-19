import { useAuthStore } from '@shared/store/auth';
import { useWorkspaceStore } from '@shared/store/workspace';
import { resolveEffectivePlan } from './effective-plan';
import type { FeatureKey } from './keys';
import { resolveFeature } from './resolve';

/** Subscribe to effective workspace plan and resolve a feature key. */
export function useFeature(key: FeatureKey): boolean {
    const personalPlan = useAuthStore((s) => s.plan);
    const authUserId = useAuthStore((s) => s.user?.id ?? '');
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const ownerPlanById = useWorkspaceStore((s) => s.ownerPlanById);

    const plan = resolveEffectivePlan({
        personalPlan,
        authUserId,
        activeOwnerId,
        ownerPlanById,
        featureKey: key,
    });

    return resolveFeature(key, { plan });
}
