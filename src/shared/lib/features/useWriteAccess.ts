import { useAuthStore } from '@shared/store/auth';
import { resolveWorkspaceOwnerId, useWorkspaceStore } from '@shared/store/workspace';
import { isWritablePlan } from './plan-matrix';
import { useEffectivePlan } from './useEffectivePlan';
import { useExpiryClock } from './useExpiryClock';
import { useRoastChargeUsage } from './useRoastChargeUsage';

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
    const plan = useEffectivePlan();

    const membershipOwnerIds = Object.keys(ownerPlanById);
    const workspaceOwnerId = resolveWorkspaceOwnerId(activeOwnerId, authUserId, membershipOwnerIds);
    const trial = plan === 'trial' || plan === 'trial-event';
    const { data: usage } = useRoastChargeUsage(workspaceOwnerId, plan, trial);
    const now = useExpiryClock(usage?.period_end);
    if (trial) {
        return (
            !!usage?.period_end &&
            now < new Date(usage.period_end).getTime() &&
            usage.used_batches < (usage.batch_cap ?? Infinity)
        );
    }

    if (!isWritablePlan(plan)) return false;

    return true;
}
