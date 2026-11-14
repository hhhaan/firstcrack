import { useRedeemOrgInvite } from '@entities/organization';
import { mapInviteError } from './lib/mapInviteError';

export function useRedeemInvite() {
    const mutation = useRedeemOrgInvite();

    return {
        ...mutation,
        redeem: async (token: string) => {
            try {
                const orgId = await mutation.mutateAsync(token.trim());
                return { orgId, error: null };
            } catch (e) {
                return { orgId: null as string | null, error: mapInviteError(e) };
            }
        },
    };
}
