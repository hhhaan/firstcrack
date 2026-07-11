import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ActiveRoastOnboardingState {
    /** Persisted — only set when user clicks "Don't show again". */
    fullscreenHintSeen: boolean;
    /** In-memory only — resets on app restart. */
    sessionDismissed: boolean;
    markFullscreenHintSeen: () => void;
    dismissForSession: () => void;
}

export const useActiveRoastOnboardingStore = create<ActiveRoastOnboardingState>()(
    persist(
        (set) => ({
            fullscreenHintSeen: false,
            sessionDismissed: false,
            markFullscreenHintSeen: () => set({ fullscreenHintSeen: true, sessionDismissed: true }),
            dismissForSession: () => set({ sessionDismissed: true }),
        }),
        {
            name: 'fc_active_roast_onboarding',
            partialize: (state) => ({ fullscreenHintSeen: state.fullscreenHintSeen }),
        },
    ),
);
