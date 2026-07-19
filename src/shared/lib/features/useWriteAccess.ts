import { useAuthStore } from '@shared/store/auth';
import { isWritablePlan, trialEndsAt } from './plan-matrix';

/**
 * UX mirror of the server write gate — read_only plan or expired trial.
 * DB triggers (profile_write_error) are the authority; this only drives disabled states/CTA.
 */
export function useWriteAccess(): boolean {
    const plan = useAuthStore((s) => s.plan);
    const user = useAuthStore((s) => s.user);
    if (!isWritablePlan(plan)) return false;
    if (plan === 'trial' && user?.created_at && Date.now() > trialEndsAt(user.created_at).getTime()) {
        return false;
    }
    return true;
}
