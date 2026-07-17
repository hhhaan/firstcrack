/**
 * POST /channel-disconnect
 * Body: { connectionId: string }
 * Deletes connection (cascade secrets). Orders stay with connection_id nulled.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';

Deno.serve(async (req) => {
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

    // Client RLS allows delete on own connections; secrets cascade.
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );

    const { error } = await supabase
        .from('sales_channel_connections')
        .delete()
        .eq('id', connectionId)
        .eq('user_id', user.id);

    if (error) {
        console.error('[channel-disconnect]', error);
        return jsonResponse({ error: 'Failed to disconnect' }, 500);
    }

    return jsonResponse({ ok: true });
});
