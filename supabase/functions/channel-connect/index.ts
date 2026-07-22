/**
 * POST /channel-connect
 * Body: { platform: 'naver'|'cafe24'|'shopify'|'toss_place', credentials: {...}, displayName?: string, confirmMerchant?: boolean }
 *
 * Validates credentials against the live platform API, then stores connection + secrets.
 * Secrets are written with service role only.
 * toss_place: app keys from env; credentials = { merchant_id }; claim install + confirmMerchant (§3.4).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getAuthenticatedUser, jsonResponse } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import type { ChannelSecrets, Platform } from '../_shared/channels/types.ts';

const PLATFORMS = new Set(['naver', 'cafe24', 'shopify', 'toss_place']);

function serviceClient() {
    return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
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
        // Cafe24 production connect is OAuth (cafe24-oauth-start / callback).
        return 'cafe24 requires OAuth — use cafe24-oauth-start';
    } else if (platform === 'toss_place') {
        const mid = credentials.merchant_id ?? credentials.merchantId;
        if (mid == null || String(mid).trim() === '') {
            return 'toss_place requires merchant_id';
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
        /** toss_place §3.4: user confirmed "이 매장이 맞습니까?" after preview */
        confirmMerchant?: boolean;
    };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const platform = body.platform as Platform;
    if (!platform || !PLATFORMS.has(platform)) {
        return jsonResponse({ error: 'platform must be naver | cafe24 | shopify | toss_place' }, 400);
    }
    if (!body.credentials || typeof body.credentials !== 'object') {
        return jsonResponse({ error: 'credentials required' }, 400);
    }

    const credErr = validateCredentials(platform, body.credentials);
    if (credErr) return jsonResponse({ error: credErr }, 400);

    // Normalize toss_place merchant_id (client sends merchant_id only)
    let credentials: ChannelSecrets = { ...body.credentials };
    if (platform === 'toss_place') {
        credentials = {
            merchant_id: String(credentials.merchant_id ?? '').trim(),
        };
    }

    const adapter = getAdapter(platform);
    let shopIdentifier: string;
    let displayName: string;
    let secretsToStore: ChannelSecrets = { ...credentials };
    let apiDisplayName: string | undefined;

    try {
        const test = await adapter.testConnection(credentials);
        shopIdentifier = test.shopIdentifier;
        apiDisplayName = test.displayName;
        displayName = body.displayName?.trim() || test.displayName;

        // Persist refreshed tokens if adapter minted any during test
        const refreshed = await adapter.refreshAuth(credentials);
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

    // toss_place §3.4: claim install + confirm store name (not just unique index)
    if (platform === 'toss_place') {
        const { data: install } = await admin
            .from('toss_place_installations')
            .select('merchant_id, uninstalled_at, claimed_user_id, claimed_connection_id')
            .eq('merchant_id', shopIdentifier)
            .maybeSingle();

        if (install?.uninstalled_at) {
            return jsonResponse({ error: 'This merchant uninstalled the First Crack app' }, 400);
        }
        if (install?.claimed_user_id && install.claimed_user_id !== user.id) {
            return jsonResponse({ error: 'This merchantId is already linked to another workspace' }, 409);
        }

        const { data: claimed } = await admin
            .from('sales_channel_connections')
            .select('id, user_id')
            .eq('platform', 'toss_place')
            .eq('shop_identifier', shopIdentifier)
            .maybeSingle();
        if (claimed && claimed.user_id !== user.id) {
            return jsonResponse({ error: 'This merchantId is already linked to another workspace' }, 409);
        }

        // Preview step: return store name; client must re-POST with confirmMerchant: true
        if (!body.confirmMerchant) {
            return jsonResponse({
                needsConfirm: true,
                merchantId: shopIdentifier,
                displayName: apiDisplayName ?? displayName,
            });
        }
    }

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
            if (error?.code === '23505') {
                return jsonResponse({ error: 'This merchantId is already linked to another workspace' }, 409);
            }
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

    if (platform === 'toss_place') {
        // Claim only if installation.created already recorded — never invent install rows here
        await admin
            .from('toss_place_installations')
            .update({
                claimed_connection_id: connectionId,
                claimed_user_id: user.id,
                claimed_at: now,
                updated_at: now,
            })
            .eq('merchant_id', shopIdentifier)
            .is('uninstalled_at', null);
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
