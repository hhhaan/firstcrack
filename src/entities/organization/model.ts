import { useAuthStore } from '@shared/store/auth';
import { resolveWorkspaceOwnerId, useWorkspaceStore } from '@shared/store/workspace';
import { useEffect, useMemo } from 'react';
import { useMyMemberships } from './queries';

/** Active workspace owner id for data queries (self or team owner). */
export function useActiveWorkspace() {
    const authUserId = useAuthStore((s) => s.user?.id ?? '');
    const activeOwnerId = useWorkspaceStore((s) => s.activeOwnerId);
    const setActiveOwner = useWorkspaceStore((s) => s.setActiveOwner);
    const { data: memberships = [] } = useMyMemberships(authUserId);

    const membershipOwnerIds = useMemo(() => memberships.map((m) => m.owner_id), [memberships]);

    const workspaceOwnerId = useMemo(
        () => (authUserId ? resolveWorkspaceOwnerId(activeOwnerId, authUserId, membershipOwnerIds) : ''),
        [activeOwnerId, authUserId, membershipOwnerIds],
    );

    // Reset stale activeOwnerId when membership was removed
    useEffect(() => {
        if (!authUserId || !activeOwnerId) return;
        if (activeOwnerId === authUserId) return;
        if (!membershipOwnerIds.includes(activeOwnerId)) {
            setActiveOwner(null);
        }
    }, [authUserId, activeOwnerId, membershipOwnerIds, setActiveOwner]);

    const isForeignWorkspace = !!authUserId && workspaceOwnerId !== authUserId;

    return {
        authUserId,
        workspaceOwnerId,
        activeOwnerId,
        setActiveOwner,
        memberships,
        isForeignWorkspace,
    };
}
