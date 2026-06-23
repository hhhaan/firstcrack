import { useAuthStore } from '@shared/store/auth';
import { listen } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useEffect, useRef } from 'react';
import { exchangeOAuthCallbackUrl } from '../lib/oauthCallback';

export const useOAuthDeepLink = () => {
    const cancelOAuth = useAuthStore((s) => s.cancelOAuth);
    const inFlight = useRef(new Set<string>());

    useEffect(() => {
        const handleUrl = async (url: string) => {
            if (inFlight.current.has(url)) return;
            inFlight.current.add(url);

            const result = await exchangeOAuthCallbackUrl(url);
            if (!result.ok) {
                inFlight.current.delete(url);
                if (result.error === 'Not an OAuth callback URL') return;
                cancelOAuth(result.error);
            }
        };

        const handleUrls = (urls: string[]) => {
            if (urls.length) void handleUrl(urls[0]);
        };

        getCurrent().then((urls) => {
            if (urls?.length) void handleUrl(urls[0]);
        });

        let unlistenDeepLink: (() => void) | undefined;
        onOpenUrl(handleUrls).then((fn) => {
            unlistenDeepLink = fn;
        });

        let unlistenBackup: (() => void) | undefined;
        listen<string>('oauth-callback-url', (event) => {
            void handleUrl(event.payload);
        }).then((fn) => {
            unlistenBackup = fn;
        });

        return () => {
            unlistenDeepLink?.();
            unlistenBackup?.();
        };
    }, [cancelOAuth]);
};
