/**
 * POST /cafe24-oauth-start
 * Body: { mallId: string, displayName?: string }
 * Auth: user JWT
 * Returns: { authorizeUrl: string }
 */
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import {
    buildCafe24AuthorizeUrl,
    cafe24AppCredentials,
    cafe24RedirectUri,
    normalizeMallId,
    signCafe24OAuthState,
} from '../_shared/channels/cafe24-oauth.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: { mallId?: string; displayName?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const mallId = normalizeMallId(body.mallId ?? '');
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
        return jsonResponse({ error: 'valid mallId required' }, 400);
    }

    try {
        const { clientId } = cafe24AppCredentials();
        const redirectUri = cafe24RedirectUri();
        const state = await signCafe24OAuthState({
            userId: user.id,
            mallId,
            displayName: body.displayName?.trim() || undefined,
            nonce: crypto.randomUUID(),
            exp: Date.now() + 10 * 60 * 1000,
        });
        const authorizeUrl = buildCafe24AuthorizeUrl(mallId, clientId, redirectUri, state);
        return jsonResponse({ authorizeUrl });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[cafe24-oauth-start]', msg);
        return jsonResponse({ error: msg }, 500);
    }
});
