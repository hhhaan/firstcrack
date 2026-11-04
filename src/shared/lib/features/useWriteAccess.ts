import { useAuthStore } from '@shared/store/auth';
import { resolveWorkspaceOwnerId, useWorkspaceStore } from '@shared/store/workspace';
import { useState } from 'react';
import { isWritablePlan, TRIAL_EVENT_BATCH_CAP, trialEndsAt } from './plan-matrix';
import { useEffectivePlan } from './useEffectivePlan';
import { useExpiryClock } from './useExpiryClock';
import { useTrialEventGrant } from './useTrialEventGrant';

/**
 * UX mirror of the server write gate.
 * Org workspace writes always target the host (admin) account — gates use host plan.
 * Personal workspace uses personal plan + trial expiry.
 */
export function useWriteAccess(): boolean {
    const user = useAuthStore((s) => s.user);
    const authUserId = user?.id ?? '';
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const ownerPlanById = useWorkspaceStore((s) => s.ownerPlanById);
    const [nowMs] = useState(() => Date.now());
    // Same-shape resolution as useEffectivePlan; foreign workspace still needs the raw
    // ownerPlanById lookup below since it bypasses personal-plan resolution entirely.
    const plan = useEffectivePlan();

    const membershipOwnerIds = Object.keys(ownerPlanById);
    const workspaceOwnerId = resolveWorkspaceOwnerId(activeOwnerId, authUserId, membershipOwnerIds);
    const isForeignWorkspace = !!authUserId && !!workspaceOwnerId && workspaceOwnerId !== authUserId;
    const { data: eventGrant } = useTrialEventGrant(workspaceOwnerId, plan === 'trial-event');
    const eventNow = useExpiryClock(eventGrant?.ends_at);
    if (plan === 'trial-event') {
        return (
            !!eventGrant &&
            eventNow < new Date(eventGrant.ends_at).getTime() &&
            eventGrant.used_batches < TRIAL_EVENT_BATCH_CAP
        );
    }

    // Shared org workspace → admin/host plan only (unified R/W on owner account).
    if (isForeignWorkspace) {
        const hostPlan = ownerPlanById[workspaceOwnerId] ?? '';
        return isWritablePlan(hostPlan);
    }

    if (!isWritablePlan(plan)) return false;

    if (plan === 'trial' && user?.created_at && nowMs > trialEndsAt(user.created_at).getTime()) {
        return false;
    }
    return true;
}
