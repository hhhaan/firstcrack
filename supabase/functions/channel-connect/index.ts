/**
 * POST /channel-connect
 * Body: { platform: 'naver'|'cafe24'|'shopify', credentials: {...}, displayName?: string }
 *
 * Validates credentials against the live platform API, then stores connection + secrets.
 * Secrets are written with service role only.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import type { ChannelSecrets, Platform } from '../_shared/channels/types.ts';

const PLATFORMS = new Set(['naver', 'cafe24', 'shopify']);

function serviceClient() {
    return createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
}

function validateCredentials(platform: Platform, credentials: ChannelSecrets): string | null {
    if (platform === 'naver') {
        if (!credentials.client_id || !credentials.client_secret) {
            return 'naver requires client_id and client_secret';
        }
    } else if (platform === 'shopify') {
        if (!credentials.shop || !credentials.access_token) {
            return 'shopify requires shop and access_token';
        }
    } else if (platform === 'cafe24') {
        if (!credentials.mall_id || !credentials.access_token) {
            return 'cafe24 requires mall_id and access_token';
        }
    }
    return null;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const user = await getAuthenticatedUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: {
        platform?: string;
        credentials?: ChannelSecrets;
        displayName?: string;
        connectionId?: string; // re-auth existing
    };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const platform = body.platform as Platform;
    if (!platform || !PLATFORMS.has(platform)) {
        return jsonResponse({ error: 'platform must be naver | cafe24 | shopify' }, 400);
    }
    if (!body.credentials || typeof body.credentials !== 'object') {
        return jsonResponse({ error: 'credentials required' }, 400);
    }

    const credErr = validateCredentials(platform, body.credentials);
    if (credErr) return jsonResponse({ error: credErr }, 400);

    const adapter = getAdapter(platform);
    let shopIdentifier: string;
    let displayName: string;
    let secretsToStore: ChannelSecrets = { ...body.credentials };

    try {
        const test = await adapter.testConnection(body.credentials);
        shopIdentifier = test.shopIdentifier;
        displayName = body.displayName?.trim() || test.displayName;

        // Persist refreshed tokens if adapter minted any during test
        const refreshed = await adapter.refreshAuth(body.credentials);
        if (refreshed) secretsToStore = { ...secretsToStore, ...refreshed };

        // Naver: store access_token from a second exchange so first sync is fast
        if (platform === 'naver') {
            const again = await adapter.refreshAuth(secretsToStore);
            if (again) secretsToStore = { ...secretsToStore, ...again };
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[channel-connect] test failed', platform, msg);
        return jsonResponse({ error: `Connection test failed: ${msg}` }, 400);
    }

    const admin = serviceClient();
    const now = new Date().toISOString();

    // Upsert connection by (user, platform, shop_identifier)
    const { data: existing } = await admin
        .from('sales_channel_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('platform', platform)
        .eq('shop_identifier', shopIdentifier)
        .maybeSingle();

    let connectionId: string;

    if (existing?.id || body.connectionId) {
        connectionId = (existing?.id ?? body.connectionId) as string;
        const { error } = await admin
            .from('sales_channel_connections')
            .update({
                display_name: displayName,
                shop_identifier: shopIdentifier,
                status: 'active',
                last_error: null,
                consecutive_failures: 0,
                updated_at: now,
            })
            .eq('id', connectionId)
            .eq('user_id', user.id);
        if (error) {
            console.error('[channel-connect] update', error);
            return jsonResponse({ error: 'Failed to update connection' }, 500);
        }
    } else {
        const { data: created, error } = await admin
            .from('sales_channel_connections')
            .insert({
                user_id: user.id,
                platform,
                shop_identifier: shopIdentifier,
                display_name: displayName,
                status: 'active',
            })
            .select('id')
            .single();
        if (error || !created) {
            console.error('[channel-connect] insert', error);
            return jsonResponse({ error: 'Failed to create connection' }, 500);
        }
        connectionId = created.id;
    }

    const { error: secretErr } = await admin.from('sales_channel_secrets').upsert({
        connection_id: connectionId,
        credentials: secretsToStore,
        updated_at: now,
    });
    if (secretErr) {
        console.error('[channel-connect] secrets', secretErr);
        return jsonResponse({ error: 'Failed to store credentials' }, 500);
    }

    return jsonResponse({
        connection: {
            id: connectionId,
            platform,
            shop_identifier: shopIdentifier,
            display_name: displayName,
            status: 'active',
        },
    });
});
