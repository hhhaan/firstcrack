import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi } from './api';
import type { MineOrg, OrgMembership } from './types';

export const organizationKeys = {
    all: ['organizations'] as const,
    mine: (userId: string) => [...organizationKeys.all, 'mine', userId] as const,
    memberships: (userId: string) => [...organizationKeys.all, 'memberships', userId] as const,
};

export function invalidateOrganizationQueries(qc: ReturnType<typeof useQueryClient>, userId: string) {
    void qc.invalidateQueries({ queryKey: organizationKeys.mine(userId) });
    void qc.invalidateQueries({ queryKey: organizationKeys.memberships(userId) });
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

export const useCreateOrgInvite = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (token: string) => organizationApi.createInvite(token),
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export const useRedeemOrgInvite = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (token: string) => organizationApi.redeemInvite(token),
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export const useRemoveOrgMember = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ orgId, memberId }: { orgId: string; memberId: string }) =>
            organizationApi.removeMember(orgId, memberId),
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export const useRevokeOrgInvite = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (inviteId: string) => organizationApi.revokeInvite(inviteId),
        onSuccess: () => invalidateOrganizationQueries(qc, userId),
    });
};

export type { MineOrg, OrgMembership };
