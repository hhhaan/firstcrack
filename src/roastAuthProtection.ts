import { useRoastingStore } from './features/active-roast/model/status';
import { useAuthStore } from './shared/store/auth';

/** Subscribe before auth initialization; changes at Charge/Drop/disconnect are synchronous. */
export function protectRoastSession(): () => void {
    const update = () => {
        const state = useRoastingStore.getState();
        useAuthStore
            .getState()
            .setSessionProtection(
                state.phase !== 'idle' ||
                    state.sidecarConnected ||
                    state.reconnecting ||
                    (state.pid != null && state.pid.state !== 'off'),
            );
    };
    update();
    return useRoastingStore.subscribe(update);
}
