import { useAuthStore } from '@shared/store/auth';
import { useCallback } from 'react';
import { uploadRoastProfile } from './uploadRoastProfile';

export const useUploadRoastProfile = () => {
    const user = useAuthStore((s) => s.user);

    return useCallback(
        async (sessionId: string): Promise<string | null> => {
            if (!user) throw new Error('Not authenticated');
            return uploadRoastProfile(sessionId, user.id);
        },
        [user],
    );
};
