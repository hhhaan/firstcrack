import { fetchProfile } from '@shared/lib/profile';
import { profileKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useQuery } from '@tanstack/react-query';
import { FEATURE, type FeatureKey } from './keys';
import { resolveFeature } from './resolve';
import { useEffectivePlan } from './useEffectivePlan';

/** Own profile flag. Same cache as `useEffectivePlan`. Missing row stays off. */
function useOwnSimulatorEnabled(): boolean {
    const authUserId = useAuthStore((state) => state.user?.id ?? '');
    const { data: enabled = false } = useQuery({
        queryKey: profileKeys.detail(authUserId),
        queryFn: () => fetchProfile(authUserId),
        enabled: !!authUserId,
        select: (row) => row?.simulator_enabled === true,
    });
    return enabled;
}

/** Subscribe to effective workspace plan and resolve a feature key. */
export function useFeature(key: FeatureKey): boolean {
    const simulatorEnabled = useOwnSimulatorEnabled();
    const profileOverrides =
        key === FEATURE.simulator ? new Map<string, boolean>([[FEATURE.simulator, simulatorEnabled]]) : undefined;
    return resolveFeature(key, { plan: useEffectivePlan(key), profileOverrides });
}
