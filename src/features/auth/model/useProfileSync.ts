import { logger } from '@shared/lib/logger';
import { fetchProfile } from '@shared/lib/profile';
import { profileKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

/** Mounted once: Polar changes the account outside the desktop mutation lifecycle. */
export function useProfileSync(): void {
    const userId = useAuthStore((state) => state.user?.id ?? '');
    const qc = useQueryClient();
    const [active, setActive] = useState(() => document.visibilityState !== 'hidden');
    const profileEdits = useIsMutating({ mutationKey: [...profileKeys.detail(userId), 'update'], exact: true });

    useQuery({
        queryKey: profileKeys.detail(userId),
        queryFn: () => fetchProfile(userId),
        enabled: !!userId && active && profileEdits === 0,
        refetchOnMount: 'always',
        refetchOnReconnect: 'always',
        // A webhook can arrive after focus returns. Keep checking while the app is active.
        refetchInterval: 30_000,
    });

    useEffect(() => {
        if (!userId) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        const updateFocus = (focused: boolean) => {
            if (disposed) return;
            const visible = focused && document.visibilityState !== 'hidden';
            setActive(visible);
            if (
                visible &&
                qc.isMutating({ mutationKey: [...profileKeys.detail(userId), 'update'], exact: true }) === 0
            ) {
                void qc.invalidateQueries(
                    { queryKey: profileKeys.detail(userId), exact: true },
                    { cancelRefetch: false },
                );
            }
        };
        const onFocus = () => updateFocus(true);
        const onBlur = () => updateFocus(false);
        const onVisibility = () => updateFocus(document.visibilityState !== 'hidden');
        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);
        document.addEventListener('visibilitychange', onVisibility);
        if (isTauri()) {
            void getCurrentWindow()
                .onFocusChanged(({ payload }) => updateFocus(payload))
                .then((stop) => {
                    if (disposed) stop();
                    else unlisten = stop;
                })
                .catch((error: unknown) => logger.capture(error, { feature: 'profile-sync' }));
        }
        return () => {
            disposed = true;
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('visibilitychange', onVisibility);
            unlisten?.();
        };
    }, [qc, userId]);
}
