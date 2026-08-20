import { profileKeys } from '@shared/lib/query-keys';
import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { useWorkspaceStore } from '@shared/store/workspace';
import type { Profile } from '@shared/types/database.types';
import { useQuery } from '@tanstack/react-query';
import { resolveEffectivePlan } from './effective-plan';
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
    const { data: personalPlan = '' } = useQuery({
        queryKey: profileKeys.detail(authUserId),
        queryFn: async (): Promise<Profile | null> => {
            const { data } = await supabase.from('profiles').select('*').eq('id', authUserId).single();
            return data;
        },
        enabled: !!authUserId,
        select: (row) => row?.plan ?? '',
    });

    return resolveEffectivePlan({ personalPlan, authUserId, activeOwnerId, ownerPlanById, featureKey });
}
