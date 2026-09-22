import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureEdgeException } from './sentry.ts';

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

export const createUserClient = (req: Request) => {
    const authHeader = req.headers.get('Authorization') ?? '';
    return createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );
};

export const getAuthenticatedUser = async (req: Request) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return null;

    const supabase = createUserClient(req);

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
};

export const serviceClient = () =>
    createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

/**
 * The workspace owner whose rows this request may write.
 *
 * Domain rows are owned by the workspace owner — RLS is
 * `has_workspace_access(user_id)`, not `auth.uid() = user_id`
 * (`20260718044457_workspaces.sql`). An Edge Function writing with the service
 * role bypasses RLS, so it must resolve the *same* owner the policy would
 * accept; using `auth.uid()` creates rows a member's workspace-scoped list can
 * never see.
 *
 * `requestedOwnerId` comes from the client and is therefore verified, never
 * trusted: the check runs `has_workspace_access` through the **user's** client
 * so `auth.uid()` is the caller, reusing the exact RLS predicate instead of
 * re-implementing the membership join. Returns null when access is denied —
 * callers must answer 403.
 */
export const resolveWorkspaceOwner = async (
    req: Request,
    requestedOwnerId: string | undefined,
    authUserId: string,
): Promise<string | null> => {
    const requested = requestedOwnerId?.trim();
    if (!requested || requested === authUserId) return authUserId;

    const { data, error } = await createUserClient(req).rpc('has_workspace_access', {
        target_owner: requested,
    });
    if (error) {
        console.error('[auth] has_workspace_access', error);
        await captureEdgeException(error, { function: 'resolve-workspace-owner', status: 500 });
        return null;
    }
    return data === true ? requested : null;
};
