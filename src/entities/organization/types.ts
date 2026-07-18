import type { Database } from '@shared/types/database.types';

export type OrgRole = 'owner' | 'member';

export type Organization = Database['public']['Tables']['organizations']['Row'];
export type OrganizationInvite = Database['public']['Tables']['organization_invites']['Row'];

export type OrganizationMember = Database['public']['Tables']['organization_members']['Row'] & {
    role: OrgRole;
    display_name?: string | null;
    business_name?: string | null;
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
