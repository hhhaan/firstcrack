import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { type UseUpdateCheckerReturn, useUpdateChecker } from './useUpdateChecker';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const UpdaterContext = createContext<UseUpdateCheckerReturn | null>(null);

export function UpdateCheckerProvider({ children }: { children: ReactNode }) {
    const checker = useUpdateChecker();

    useEffect(() => {
        void checker.checkForUpdate();
        const id = setInterval(() => {
            void checker.checkForUpdate();
        }, CHECK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [checker.checkForUpdate]);

    return <UpdaterContext.Provider value={checker}>{children}</UpdaterContext.Provider>;
}

export function useUpdater(): UseUpdateCheckerReturn {
    const value = useContext(UpdaterContext);
    if (!value) throw new Error('useUpdater must be used within UpdateCheckerProvider');
    return value;
}
