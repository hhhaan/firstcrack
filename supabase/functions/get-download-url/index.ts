import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { presignDownloadUrl } from '../_shared/r2.ts';

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

    try {
        const url = await presignDownloadUrl(user.id, key);
        return jsonResponse({ url });
    } catch (err) {
        if (err instanceof Error && err.message === 'Forbidden') {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }
        console.error('[get-download-url]', err);
        return jsonResponse({ error: 'Failed to generate download URL' }, 500);
    }
});
