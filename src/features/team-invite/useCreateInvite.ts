import { useCreateOrgInvite } from '@entities/organization';
import { generateToken } from '@shared/lib/token';
import { mapInviteError } from './lib/mapInviteError';

export function useCreateInvite() {
    const mutation = useCreateOrgInvite();

    return {
        ...mutation,
        create: async () => {
            const token = generateToken();
            try {
                await mutation.mutateAsync(token);
                return { token, error: null };
            } catch (e) {
                return { token: null as string | null, error: mapInviteError(e) };
            }
        },
    };
}
