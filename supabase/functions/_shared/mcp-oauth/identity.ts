import { createUserClient, getAuthenticatedUser } from '../auth.ts';
import type { NativeIdentity } from './service.ts';

export async function resolveNativeIdentity(req: Request): Promise<NativeIdentity | null> {
    const user = await getAuthenticatedUser(req);
    if (!user || user.is_anonymous) return null;
    const client = createUserClient(req);
    const [{ data: orgs, error: orgError }, { data: profile, error: profileError }] = await Promise.all([
        client.from('organizations').select('owner_id,name').limit(100),
        client.from('profiles').select('business_name,display_name').eq('id', user.id).maybeSingle(),
    ]);
    if (orgError || profileError) throw new Error('Could not verify current workspaces');
    const workspaces = new Map<string, string>([
        [user.id, profile?.business_name || profile?.display_name || 'Personal workspace'],
    ]);
    for (const org of orgs ?? []) workspaces.set(org.owner_id, org.name);
    return { userId: user.id, workspaces: Array.from(workspaces, ([owner_id, name]) => ({ owner_id, name })) };
}
