import { resolveWorkspaceOwnerId } from '@shared/store/workspace';
import { FEATURE, type FeatureKey } from './keys';

export type EffectivePlanInput = {
    personalPlan: string;
    authUserId: string;
    activeOwnerId: string | null;
    ownerPlanById: Readonly<Record<string, string>>;
    /** When set, hosting-only features always use personal plan. */
    featureKey?: FeatureKey;
};

/**
 * Plan used for feature gates in the active workspace.
 * - Self workspace → personal plan
 * - Foreign workspace → host (owner) plan when known
 * - FEATURE.team (host invites) → always personal
 * - Foreign + unknown owner plan → '' (deny gated features until loaded)
 */
export function resolveEffectivePlan(input: EffectivePlanInput): string {
    const { personalPlan, authUserId, activeOwnerId, ownerPlanById, featureKey } = input;

    if (featureKey === FEATURE.team) {
        return personalPlan;
    }

    if (!authUserId) return personalPlan;

    const membershipOwnerIds = Object.keys(ownerPlanById);
    const workspaceOwnerId = resolveWorkspaceOwnerId(activeOwnerId, authUserId, membershipOwnerIds);

    if (!workspaceOwnerId || workspaceOwnerId === authUserId) {
        return personalPlan;
    }

    return ownerPlanById[workspaceOwnerId] ?? '';
}
