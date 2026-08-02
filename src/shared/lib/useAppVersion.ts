import { useEffect, useState } from 'react';

const TAURI = '__TAURI_INTERNALS__' in window;

export const useAppVersion = (): string => {
    const [version, setVersion] = useState<string>('');

    useEffect(() => {
        if (!TAURI) return;

        let cancelled = false;
        import('@tauri-apps/api/app')
            .then(({ getVersion }) => getVersion())
            .then((v) => {
                if (!cancelled) setVersion(v);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, []);

    return version;
};
