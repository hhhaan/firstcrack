export type OrgRole = 'owner' | 'member';

export type Organization = {
    id: string;
    owner_id: string;
    name: string;
    seat_limit: number;
    created_at: string;
};

export type OrganizationMember = {
    org_id: string;
    user_id: string;
    role: OrgRole;
    created_at: string;
    display_name?: string | null;
    business_name?: string | null;
};

export type OrganizationInvite = {
    id: string;
    org_id: string;
    token: string;
    expires_at: string;
    accepted_by: string | null;
    accepted_at: string | null;
    revoked_at: string | null;
    created_at: string;
};

export type OrgMembership = {
    org_id: string;
    role: OrgRole;
    owner_id: string;
    org_name: string;
    owner_business_name: string | null;
    owner_display_name: string | null;
};

export type MineOrg = Organization & {
    members: OrganizationMember[];
    invites: OrganizationInvite[];
};
