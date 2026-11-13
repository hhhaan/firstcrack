import { useRemoveOrgMember } from '@entities/organization';
import { mapInviteError } from './lib/mapInviteError';

export function useRemoveMember() {
    const mutation = useRemoveOrgMember();

    return {
        ...mutation,
        remove: async (orgId: string, memberId: string) => {
            try {
                await mutation.mutateAsync({ orgId, memberId });
                return { error: null };
            } catch (e) {
                return { error: mapInviteError(e) };
            }
        },
    };
}
