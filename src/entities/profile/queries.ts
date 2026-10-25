import { profileKeys } from '@shared/lib/query-keys';
import type { Profile } from '@shared/types/database.types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi } from './api';

type ProfilePatch = Partial<
    Pick<
        Profile,
        'display_name' | 'avatar_url' | 'business_name' | 'business_registration_number' | 'default_roast_profile_id'
    >
>;

// Concurrent optimistic edits share the last confirmed row, never another edit's snapshot.
const editGroups = new WeakMap<QueryClient, Map<string, { confirmed: Profile | null | undefined }>>();

export const useProfile = (userId: string) =>
    useQuery({
        queryKey: profileKeys.detail(userId),
        queryFn: () => profileApi.get(userId),
        enabled: !!userId,
    });

export const useUpdateProfile = (userId: string) => {
    const qc = useQueryClient();
    const queryKey = profileKeys.detail(userId);
    const mutationKey = [...queryKey, 'update'];
    return useMutation({
        mutationKey,
        scope: { id: `profile:${userId}` },
        mutationFn: (patch: ProfilePatch) => profileApi.update(userId, patch),
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey, exact: true });
            let groups = editGroups.get(qc);
            if (!groups) {
                groups = new Map();
                editGroups.set(qc, groups);
            }
            let group = groups.get(userId);
            if (!group) {
                group = { confirmed: qc.getQueryData<Profile | null>(queryKey) };
                groups.set(userId, group);
            }
            qc.setQueryData<Profile | null>(queryKey, (current) => (current ? { ...current, ...patch } : current));
            return group;
        },
        onSuccess: (updated, _patch, group) => {
            group.confirmed = updated;
        },
        onSettled: (_updated, _error, _patch, group) => {
            if (qc.isMutating({ mutationKey, exact: true }) !== 1) return;
            if (group) qc.setQueryData(queryKey, group.confirmed);
            editGroups.get(qc)?.delete(userId);
            return qc.invalidateQueries({ queryKey, exact: true });
        },
    });
};
