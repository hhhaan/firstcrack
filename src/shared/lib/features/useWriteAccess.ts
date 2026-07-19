import { useAuthStore } from '@shared/store/auth';
import { resolveWorkspaceOwnerId, useWorkspaceStore } from '@shared/store/workspace';
import { useState } from 'react';
import { resolveEffectivePlan } from './effective-plan';
import { isWritablePlan, trialEndsAt } from './plan-matrix';

/**
 * UX mirror of the server write gate.
 * Org workspace writes always target the host (admin) account — gates use host plan.
 * Personal workspace uses personal plan + trial expiry.
 */
export function useWriteAccess(): boolean {
    const personalPlan = useAuthStore((s) => s.plan);
    const user = useAuthStore((s) => s.user);
    const authUserId = user?.id ?? '';
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const ownerPlanById = useWorkspaceStore((s) => s.ownerPlanById);
    const [nowMs] = useState(() => Date.now());

    const membershipOwnerIds = Object.keys(ownerPlanById);
    const workspaceOwnerId = resolveWorkspaceOwnerId(activeOwnerId, authUserId, membershipOwnerIds);
    const isForeignWorkspace = !!authUserId && !!workspaceOwnerId && workspaceOwnerId !== authUserId;

    // Shared org workspace → admin/host plan only (unified R/W on owner account).
    if (isForeignWorkspace) {
        const hostPlan = ownerPlanById[workspaceOwnerId] ?? '';
        return isWritablePlan(hostPlan) && hostPlan !== '';
    }

    const plan = resolveEffectivePlan({
        personalPlan,
        authUserId,
        activeOwnerId,
        ownerPlanById,
    });

    if (!isWritablePlan(plan)) return false;

    if (plan === 'trial' && user?.created_at && nowMs > trialEndsAt(user.created_at).getTime()) {
        return false;
    }
    return true;
}
