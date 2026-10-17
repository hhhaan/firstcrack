/**
 * POST /channel-products
 * Body: { connectionId: string }
 *
 * Lists the platform's product catalog for one connection so the client can map a local
 * product to a platform variant/product id (#131). Secrets stay server-side: the adapter
 * runs here with the service role and only `PlatformListing[]` leaves the function.
 *
 * Naver's adapter returns [] until its product API is wired — the client then falls back
 * to manual key entry.
 */
import {
    corsHeaders,
    getAuthenticatedUser,
    jsonResponse,
    resolveWorkspaceOwner,
    serviceClient,
} from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { loadSecretsSession } from '../_shared/channels/secrets-session.ts';
import { captureEdgeException, respondServerError, serveWithSentry } from '../_shared/sentry.ts';

serveWithSentry('channel-products', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: { connectionId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }
    const connectionId = body.connectionId?.trim();
    if (!connectionId) return jsonResponse({ error: 'connectionId required' }, 400);

    const admin = serviceClient();
    const { data: conn, error: connError } = await admin
        .from('sales_channel_connections')
        .select('id, user_id, platform, status')
        .eq('id', connectionId)
        .maybeSingle();
    if (connError) return respondServerError('channel-products', 'Failed to load connection', connError);
    if (!conn) return jsonResponse({ error: 'Connection not found' }, 404);

    // The connection belongs to a workspace owner; the caller must be that owner or a member.
    // Verified through the user's client (same RLS predicate), never trusted from the body.
    const ownerId = await resolveWorkspaceOwner(req, conn.user_id, user.id);
    if (!ownerId) return jsonResponse({ error: 'Forbidden' }, 403);

    try {
        const session = await loadSecretsSession(admin, conn.id);
        const adapter = getAdapter(conn.platform);
        const refreshed = await adapter.refreshAuth(session.current());
        if (refreshed) await session.rotate(refreshed);
        const listings = await adapter.listProducts(session.current(), session.rotate);
        return jsonResponse({ platform: conn.platform, listings });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[channel-products]', conn.platform, msg);
        await captureEdgeException(e, {
            function: 'channel-products',
            status: 502,
            tags: { platform: conn.platform },
        });
        return jsonResponse({ error: 'Failed to list products' }, 502);
    }
});
