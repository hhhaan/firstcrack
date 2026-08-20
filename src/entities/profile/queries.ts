import { profileKeys } from '@shared/lib/query-keys';
import type { Profile } from '@shared/types/database.types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi } from './api';

type ProfilePatch = Partial<
    Pick<
        Profile,
        'display_name' | 'avatar_url' | 'business_name' | 'business_registration_number' | 'default_roast_profile_id'
    >
>;

export { profileKeys };

export const useProfile = (userId: string) =>
    useQuery({
        queryKey: profileKeys.detail(userId),
        queryFn: () => profileApi.get(userId),
        enabled: !!userId,
    });

export const useUpdateProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (patch: ProfilePatch) => profileApi.update(userId, patch),
        onSuccess: (updated) => {
            qc.setQueryData(profileKeys.detail(userId), updated);
        },
    });
};
