import { supabase } from '@shared/lib/supabase';
import type { MineOrg, OrganizationMember, OrgMembership } from './types';

type MemberRow = {
    org_id: string;
    user_id: string;
    role: string;
    created_at: string;
};

export const organizationApi = {
    getMine: async (userId: string): Promise<MineOrg | null> => {
        const { data: org, error } = await supabase
            .from('organizations')
            .select('*')
            .eq('owner_id', userId)
            .maybeSingle();
        if (error) throw error;
        if (!org) return null;

        const o = org;
        const [{ data: members, error: mErr }, { data: invites, error: iErr }] = await Promise.all([
            supabase.from('organization_members').select('*').eq('org_id', o.id).order('created_at'),
            supabase
                .from('organization_invites')
                .select('*')
                .eq('org_id', o.id)
                .is('revoked_at', null)
                .order('created_at', { ascending: false }),
        ]);
        if (mErr) throw mErr;
        if (iErr) throw iErr;

        const memberRows = (members ?? []) as MemberRow[];
        const memberIds = memberRows.map((m) => m.user_id);
        const profileById = new Map<string, { display_name: string | null; business_name: string | null }>();
        if (memberIds.length > 0) {
            const { data: profiles, error: pErr } = await supabase
                .from('profiles')
                .select('id, display_name, business_name')
                .in('id', memberIds);
            if (pErr) throw pErr;
            for (const p of profiles ?? []) {
                profileById.set(p.id, {
                    display_name: p.display_name,
                    business_name: p.business_name,
                });
            }
        }

        const enriched: OrganizationMember[] = memberRows.map((m) => {
            const p = profileById.get(m.user_id);
            return {
                org_id: m.org_id,
                user_id: m.user_id,
                role: m.role as OrganizationMember['role'],
                created_at: m.created_at,
                display_name: p?.display_name ?? null,
                business_name: p?.business_name ?? null,
            };
        });

        return {
            id: o.id,
            owner_id: o.owner_id,
            name: o.name,
            seat_limit: o.seat_limit,
            created_at: o.created_at,
            members: enriched,
            invites: invites ?? [],
        };
    },

    listMemberships: async (userId: string): Promise<OrgMembership[]> => {
        const { data: memberships, error } = await supabase
            .from('organization_members')
            .select('org_id, role')
            .eq('user_id', userId);
        if (error) throw error;
        if (!memberships?.length) return [];

        const orgIds = memberships.map((m) => m.org_id);
        const { data: orgs, error: oErr } = await supabase
            .from('organizations')
            .select('id, owner_id, name')
            .in('id', orgIds);
        if (oErr) throw oErr;

        const ownerIds = [...new Set((orgs ?? []).map((o) => o.owner_id))];
        if (ownerIds.length === 0) return [];

        const { data: profiles, error: pErr } = await supabase
            .from('profiles')
            .select('id, display_name, business_name')
            .in('id', ownerIds);
        if (pErr) throw pErr;

        const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));
        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

        return memberships
            .map((m) => {
                const org = orgById.get(m.org_id);
                if (!org) return null;
                // Skip own org (owner already sees it as self workspace)
                if (org.owner_id === userId) return null;
                const profile = profileById.get(org.owner_id);
                return {
                    org_id: m.org_id,
                    role: m.role as OrgMembership['role'],
                    owner_id: org.owner_id,
                    org_name: org.name,
                    owner_business_name: profile?.business_name ?? null,
                    owner_display_name: profile?.display_name ?? null,
                } satisfies OrgMembership;
            })
            .filter((x): x is OrgMembership => x != null);
    },

    createInvite: async (token: string): Promise<string> => {
        const { data, error } = await supabase.rpc('create_org_invite', {
            p_token: token,
        });
        if (error) throw error;
        return data;
    },

    redeemInvite: async (token: string): Promise<string> => {
        const { data, error } = await supabase.rpc('redeem_org_invite', {
            p_token: token,
        });
        if (error) throw error;
        return data;
    },

    removeMember: async (orgId: string, memberId: string): Promise<void> => {
        const { error } = await supabase.rpc('remove_org_member', {
            p_org_id: orgId,
            p_member_id: memberId,
        });
        if (error) throw error;
    },

    revokeInvite: async (inviteId: string): Promise<void> => {
        const { error } = await supabase.rpc('revoke_org_invite', {
            p_invite_id: inviteId,
        });
        if (error) throw error;
    },
};
