import { corsHeaders, createUserClient, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { isValidUserId, presignDownloadUrl } from '../_shared/r2.ts';

const PROFILE_OWNER_RE = /^profiles\/([0-9a-f-]{36})\//i;

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const user = await getAuthenticatedUser(req);
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let body: { key?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const key = body.key?.trim();
    if (!key) {
        return jsonResponse({ error: 'Invalid key' }, 400);
    }

    const ownerMatch = key.match(PROFILE_OWNER_RE);
    const ownerUserId = ownerMatch?.[1];
    if (!ownerUserId || !isValidUserId(ownerUserId)) {
        return jsonResponse({ error: 'Invalid key' }, 400);
    }

    if (ownerUserId !== user.id) {
        const supabase = createUserClient(req);
        const { data: allowed, error } = await supabase.rpc('has_workspace_access', {
            target_owner: ownerUserId,
        });
        if (error || !allowed) {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }
    }

    try {
        const url = await presignDownloadUrl(ownerUserId, key);
        return jsonResponse({ url });
    } catch (err) {
        if (err instanceof Error && err.message === 'Forbidden') {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }
        console.error('[get-download-url]', err);
        return jsonResponse({ error: 'Failed to generate download URL' }, 500);
    }
});
