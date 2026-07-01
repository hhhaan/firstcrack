import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DismissedAlertsState {
    ids: string[];
    add: (id: string) => void;
    has: (id: string) => boolean;
}

export const useDismissedAlerts = create<DismissedAlertsState>()(
    persist(
        (set, get) => ({
            ids: [],
            add: (id) => set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
            has: (id) => get().ids.includes(id),
        }),
        { name: 'fc_dismissed_alerts' },
    ),
);
