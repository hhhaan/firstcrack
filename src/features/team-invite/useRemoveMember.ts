import { useRemoveOrgMember } from '@entities/organization';
import { useAuthStore } from '@shared/store/auth';
import { mapInviteError } from './lib/mapInviteError';

export function useRemoveMember() {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const mutation = useRemoveOrgMember(userId);

    return {
        ...mutation,
        remove: async (orgId: string, memberId: string) => {
            try {
                await mutation.mutateAsync({ orgId, memberId });
                return { error: null as null };
            } catch (e) {
                return { error: mapInviteError(e) };
            }
        },
    };
}
