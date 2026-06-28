import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ActiveRoastOnboardingState {
    fullscreenHintSeen: boolean;
    markFullscreenHintSeen: () => void;
}

export const useActiveRoastOnboardingStore = create<ActiveRoastOnboardingState>()(
    persist(
        (set) => ({
            fullscreenHintSeen: false,
            markFullscreenHintSeen: () => set({ fullscreenHintSeen: true }),
        }),
        { name: 'fc_active_roast_onboarding' },
    ),
);
