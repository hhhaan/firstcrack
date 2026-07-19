import { useAuthStore } from '@shared/store/auth';
import { resolveWorkspaceOwnerId, useWorkspaceStore } from '@shared/store/workspace';
import { useEffect, useMemo } from 'react';
import { useMyMemberships } from './queries';

/**
 * Active workspace owner id for data queries (self or team owner).
 * Until memberships load, a foreign activeOwnerId yields empty workspaceOwnerId
 * so queries/writes do not briefly hit the personal workspace.
 */
export function useActiveWorkspace() {
    const authUserId = useAuthStore((s) => s.user?.id ?? '');
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const setActiveOwner = useWorkspaceStore((s) => s.setActiveOwner);
    const setOwnerPlans = useWorkspaceStore((s) => s.setOwnerPlans);
    const {
        data: memberships = [],
        isFetched: membershipsFetched,
        isError: membershipsError,
    } = useMyMemberships(authUserId);

    const membershipsReady = !authUserId || membershipsFetched || membershipsError;
    const membershipOwnerIds = useMemo(() => memberships.map((m) => m.owner_id), [memberships]);

    const needsMembershipCheck = !!authUserId && !!activeOwnerId && activeOwnerId !== authUserId;

    const workspaceOwnerId = useMemo(() => {
        if (!authUserId) return '';
        if (!activeOwnerId || activeOwnerId === authUserId) return authUserId;
        // Foreign workspace: block until memberships resolve (avoid self fallback flash)
        if (!membershipsReady) return '';
        return resolveWorkspaceOwnerId(activeOwnerId, authUserId, membershipOwnerIds);
    }, [activeOwnerId, authUserId, membershipOwnerIds, membershipsReady]);

    const isWorkspaceReady = !!authUserId && (!needsMembershipCheck || membershipsReady) && !!workspaceOwnerId;

    // Reset stale activeOwnerId only after memberships loaded
    useEffect(() => {
        if (!membershipsReady || !authUserId || !activeOwnerId) return;
        if (activeOwnerId === authUserId) return;
        if (!membershipOwnerIds.includes(activeOwnerId)) {
            setActiveOwner(null);
        }
    }, [authUserId, activeOwnerId, membershipOwnerIds, membershipsReady, setActiveOwner]);

    // Hydrate host plans for feature inheritance (shared store — useFeature must not import entities).
    useEffect(() => {
        if (!membershipsReady) return;
        const plans: Record<string, string> = {};
        for (const m of memberships) {
            // Always register membership keys so foreign resolve does not fall back to self.
            plans[m.owner_id] = m.owner_plan;
        }
        setOwnerPlans(plans);
    }, [memberships, membershipsReady, setOwnerPlans]);

    const isForeignWorkspace = isWorkspaceReady && workspaceOwnerId !== authUserId;

    return {
        authUserId,
        workspaceOwnerId,
        activeOwnerId,
        setActiveOwner,
        memberships,
        isForeignWorkspace,
        isWorkspaceReady,
    };
}
