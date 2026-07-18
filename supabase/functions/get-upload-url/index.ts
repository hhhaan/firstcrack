import { corsHeaders, createUserClient, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { isValidSessionId, isValidUserId, presignUploadUrl } from '../_shared/r2.ts';

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

    let body: { sessionId?: string; kind?: string; ownerUserId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const sessionId = body.sessionId?.trim();
    if (!sessionId || !isValidSessionId(sessionId)) {
        return jsonResponse({ error: 'Invalid sessionId' }, 400);
    }

    // 잘못된 kind를 profile로 흘리면 BBP 커브가 메인 프로파일 키를 덮어쓴다
    const kind = body.kind ?? 'profile';
    if (kind !== 'profile' && kind !== 'bbp') {
        return jsonResponse({ error: 'Invalid kind' }, 400);
    }

    const ownerUserId = (body.ownerUserId?.trim() || user.id);
    if (!isValidUserId(ownerUserId)) {
        return jsonResponse({ error: 'Invalid ownerUserId' }, 400);
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
        const url = await presignUploadUrl(ownerUserId, sessionId, kind);
        return jsonResponse({ url });
    } catch (err) {
        console.error('[get-upload-url]', err);
        return jsonResponse({ error: 'Failed to generate upload URL' }, 500);
    }
});
