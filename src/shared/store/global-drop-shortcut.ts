import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { create } from 'zustand';

const KEY = 'keyboard.globalDrop';
let edited = false;
export const useGlobalDropShortcutStore = create<{
    enabled: boolean;
    status: 'idle' | 'registering' | 'ready' | 'failed' | 'unsupported';
    setEnabled: (enabled: boolean) => void;
}>((set) => ({
    enabled: false,
    status: 'idle',
    setEnabled: (enabled) => {
        edited = true;
        set({ enabled });
        try {
            localStorage.setItem(KEY, JSON.stringify(enabled));
        } catch {
            /* storage unavailable */
        }
        void settingsSet(KEY, enabled);
    },
}));
void settingsGet<boolean>(KEY).then((stored) => {
    if (edited) return;
    let fallback = false;
    try {
        fallback = localStorage.getItem(KEY) === 'true';
    } catch {
        /* storage unavailable */
    }
    useGlobalDropShortcutStore.setState({ enabled: typeof stored === 'boolean' ? stored : fallback });
});
