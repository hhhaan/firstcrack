/**
 * POST /cafe24-oauth-start
 * Body: { mallId: string, displayName?: string }
 * Auth: user JWT
 * Returns: { authorizeUrl: string }
 */
import {
    corsHeaders,
    getAuthenticatedUser,
    jsonResponse,
    resolveWorkspaceOwner,
} from '../_shared/auth.ts';
import {
    buildCafe24AuthorizeUrl,
    cafe24AppCredentials,
    cafe24RedirectUri,
    normalizeMallId,
    signCafe24OAuthState,
} from '../_shared/channels/cafe24-oauth.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';

serveWithSentry('cafe24-oauth-start', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: { mallId?: string; displayName?: string; workspaceOwnerId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const mallId = normalizeMallId(body.mallId ?? '');
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
        return jsonResponse({ error: 'valid mallId required' }, 400);
    }

    // Verified here, while the user JWT is present — the callback is a public
    // redirect and can only trust the signed state, never re-check membership.
    const ownerId = await resolveWorkspaceOwner(req, body.workspaceOwnerId, user.id);
    if (!ownerId) return jsonResponse({ error: 'Forbidden' }, 403);

    try {
        const { clientId } = cafe24AppCredentials();
        const redirectUri = cafe24RedirectUri();
        const state = await signCafe24OAuthState({
            userId: user.id,
            ownerId,
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
        await captureEdgeException(e, { function: 'cafe24-oauth-start', status: 500 });
        return jsonResponse({ error: msg }, 500);
    }
});
