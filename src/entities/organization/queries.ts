import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi } from './api';
import type { MineOrg, OrgMembership } from './types';

export const organizationKeys = {
    all: ['organizations'] as const,
    mine: (userId: string) => [...organizationKeys.all, 'mine', userId] as const,
    memberships: (userId: string) => [...organizationKeys.all, 'memberships', userId] as const,
};

export function invalidateOrganizationQueries(qc: ReturnType<typeof useQueryClient>, _userId?: string) {
    // Prefix invalidation covers mine + memberships (and future org keys).
    void qc.invalidateQueries({ queryKey: organizationKeys.all });
}

export const useMyOrganization = (userId: string) =>
    useQuery({
        queryKey: organizationKeys.mine(userId),
        queryFn: () => organizationApi.getMine(userId),
        enabled: !!userId,
    });

export const useMyMemberships = (userId: string) =>
    useQuery({
        queryKey: organizationKeys.memberships(userId),
        queryFn: () => organizationApi.listMemberships(userId),
        enabled: !!userId,
    });

/** Team settings map every failure to an inline message (`mapInviteError`) — no global toast. */
const inlineErrorMeta = { silentError: true } as const;

export const useCreateOrgInvite = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (token: string) => organizationApi.createInvite(token),
        meta: inlineErrorMeta,
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export const useRedeemOrgInvite = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (token: string) => organizationApi.redeemInvite(token),
        meta: inlineErrorMeta,
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export const useRemoveOrgMember = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ orgId, memberId }: { orgId: string; memberId: string }) =>
            organizationApi.removeMember(orgId, memberId),
        meta: inlineErrorMeta,
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export const useRevokeOrgInvite = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (inviteId: string) => organizationApi.revokeInvite(inviteId),
        meta: inlineErrorMeta,
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export type { MineOrg, OrgMembership };
