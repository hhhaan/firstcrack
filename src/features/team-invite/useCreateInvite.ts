import { useCreateOrgInvite } from '@entities/organization';
import { generateToken } from '@shared/lib/token';
import { useAuthStore } from '@shared/store/auth';
import { mapInviteError } from './lib/mapInviteError';

export function useCreateInvite() {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const mutation = useCreateOrgInvite(userId);

    return {
        ...mutation,
        create: async () => {
            const token = generateToken();
            try {
                await mutation.mutateAsync(token);
                return { token, error: null as null };
            } catch (e) {
                return { token: null as string | null, error: mapInviteError(e) };
            }
        },
    };
}
