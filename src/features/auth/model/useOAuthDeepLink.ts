import { useAuthStore } from '@shared/store/auth';
import { listen } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useEffect, useRef } from 'react';
import { exchangeOAuthCallbackUrl } from '../lib/oauthCallback';

export const useOAuthDeepLink = () => {
    const cancelOAuth = useAuthStore((s) => s.cancelOAuth);
    const inFlight = useRef(new Set<string>());

    useEffect(() => {
        const handleUrl = async (url: string, source: string) => {
            if (inFlight.current.has(url)) return;
            inFlight.current.add(url);

            const result = await exchangeOAuthCallbackUrl(url, source);
            if (!result.ok) {
                inFlight.current.delete(url);
                if (result.skip) return;
                cancelOAuth(result.code);
                return;
            }
            inFlight.current.delete(url);
        };

        const handleUrls = (urls: string[], source: string) => {
            if (urls.length) void handleUrl(urls[0], source);
        };

        void getCurrent().then((urls) => {
            if (urls?.length) void handleUrl(urls[0], 'getCurrent');
        });

        let unlistenDeepLink: (() => void) | undefined;
        void onOpenUrl((urls) => handleUrls(urls, 'onOpenUrl')).then((fn) => {
            unlistenDeepLink = fn;
        });

        let unlistenBackup: (() => void) | undefined;
        void listen<string>('oauth-callback-url', (event) => {
            void handleUrl(event.payload, 'oauth-callback-url');
        }).then((fn) => {
            unlistenBackup = fn;
        });

        return () => {
            unlistenDeepLink?.();
            unlistenBackup?.();
        };
    }, [cancelOAuth]);
};
