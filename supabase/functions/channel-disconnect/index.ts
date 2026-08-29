/**
 * POST /channel-disconnect
 * Body: { connectionId: string }
 * Deletes connection (cascade secrets). Orders stay with connection_id nulled.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';

serveWithSentry('channel-disconnect', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let connectionId: string | undefined;
    try {
        const body = await req.json();
        connectionId = body?.connectionId;
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }
    if (!connectionId) return jsonResponse({ error: 'connectionId required' }, 400);

    // Client RLS allows delete on workspace connections; secrets cascade.
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );

    // No `user_id` filter: connections are owned by the workspace owner, so
    // matching on auth.uid() silently deleted nothing for members. Authorization
    // is the RLS policy (has_workspace_access) on the anon-key client above.
    const { data: deleted, error } = await supabase
        .from('sales_channel_connections')
        .delete()
        .eq('id', connectionId)
        .select('id');

    if (error) {
        console.error('[channel-disconnect]', error);
        await captureEdgeException(error, { function: 'channel-disconnect', status: 500 });
        return jsonResponse({ error: 'Failed to disconnect' }, 500);
    }
    // RLS filtered it out or it never existed — do not report success.
    if (!deleted?.length) return jsonResponse({ error: 'connection not found' }, 404);

    return jsonResponse({ ok: true });
});
