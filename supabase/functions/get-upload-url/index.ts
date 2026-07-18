import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { isValidSessionId, presignUploadUrl } from '../_shared/r2.ts';

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

    let body: { sessionId?: string; kind?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const sessionId = body.sessionId?.trim();
    if (!sessionId || !isValidSessionId(sessionId)) {
        return jsonResponse({ error: 'Invalid sessionId' }, 400);
    }

    const kind = body.kind === 'bbp' ? 'bbp' : 'profile';

    try {
        const url = await presignUploadUrl(user.id, sessionId, kind);
        return jsonResponse({ url });
    } catch (err) {
        console.error('[get-upload-url]', err);
        return jsonResponse({ error: 'Failed to generate upload URL' }, 500);
    }
});
