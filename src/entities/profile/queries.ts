import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { profileApi } from './api'
import type { Profile } from '../../shared/types/database.types'

type ProfilePatch = Partial<Pick<Profile, 'display_name' | 'avatar_url'>>

export const profileKeys = {
    detail: (userId: string) => ['profile', userId] as const,
}

export const useProfile = (userId: string) =>
    useQuery({
        queryKey: profileKeys.detail(userId),
        queryFn: () => profileApi.get(userId),
        enabled: !!userId,
    })

export const useUpdateProfile = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (patch: ProfilePatch) => profileApi.update(userId, patch),
        onSuccess: (updated) => {
            qc.setQueryData(profileKeys.detail(userId), updated)
        },
    })
}
