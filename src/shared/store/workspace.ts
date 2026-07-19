import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * null activeOwnerId = self.
 * If active id is not self and not in membershipOwnerIds → fall back to self.
 */
export function resolveWorkspaceOwnerId(
    activeOwnerId: string | null,
    authUserId: string,
    membershipOwnerIds: readonly string[],
): string {
    if (!activeOwnerId || activeOwnerId === authUserId) return authUserId;
    if (membershipOwnerIds.includes(activeOwnerId)) return activeOwnerId;
    return authUserId;
}

interface WorkspaceState {
    activeOwnerId: string | null;
    setActiveOwner: (id: string | null) => void;
    /** Host plans for foreign workspaces the user belongs to (not persisted). */
    ownerPlanById: Record<string, string>;
    setOwnerPlans: (plans: Record<string, string>) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
    persist(
        (set) => ({
            activeOwnerId: null,
            setActiveOwner: (id) => set({ activeOwnerId: id }),
            ownerPlanById: {},
            setOwnerPlans: (plans) => set({ ownerPlanById: plans }),
        }),
        {
            name: 'fc_workspace',
            partialize: (s) => ({ activeOwnerId: s.activeOwnerId }),
        },
    ),
);
