import { useRedeemOrgInvite } from '@entities/organization';
import { useAuthStore } from '@shared/store/auth';
import { mapInviteError } from './lib/mapInviteError';

export function useRedeemInvite() {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const mutation = useRedeemOrgInvite(userId);

    return {
        ...mutation,
        redeem: async (token: string) => {
            try {
                const orgId = await mutation.mutateAsync(token.trim());
                return { orgId, error: null as null };
            } catch (e) {
                return { orgId: null as string | null, error: mapInviteError(e) };
            }
        },
    };
}
