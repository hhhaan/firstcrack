import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { type UseUpdateCheckerReturn, useUpdateChecker } from './useUpdateChecker';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const UpdaterContext = createContext<UseUpdateCheckerReturn | null>(null);

export function UpdateCheckerProvider({ children, autoDownload }: { children: ReactNode; autoDownload: boolean }) {
    const checker = useUpdateChecker();
    const checkAutomatically = autoDownload ? checker.checkAndDownload : checker.checkForUpdate;

    useEffect(() => {
        void checkAutomatically();
        const id = setInterval(() => {
            void checkAutomatically();
        }, CHECK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [checkAutomatically]);

    return <UpdaterContext.Provider value={checker}>{children}</UpdaterContext.Provider>;
}

export function useUpdater(): UseUpdateCheckerReturn {
    const value = useContext(UpdaterContext);
    if (!value) throw new Error('useUpdater must be used within UpdateCheckerProvider');
    return value;
}
