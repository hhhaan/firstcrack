/**
 * GET /cafe24-oauth-callback?code=&state=
 * Public (Cafe24 browser redirect). Exchanges code, stores connection + secrets.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cafe24Adapter } from '../_shared/channels/cafe24.ts';
import {
    assertCafe24Scopes,
    cafe24RedirectUri,
    exchangeCafe24Code,
    normalizeScopes,
    tokenExpiresAtMs,
    verifyCafe24OAuthState,
} from '../_shared/channels/cafe24-oauth.ts';
import { escapeHtml } from '../_shared/html.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';

/** A tampered/expired state is a rejected caller, not a bug — same class as a 401. */
const STATE_REJECT_RE = /invalid state|state expired|state secret/i;

function serviceClient() {
    return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

function htmlPage(title: string, body: string, ok: boolean): Response {
    const color = ok ? '#1a7f37' : '#c0392b';
    const safeTitle = escapeHtml(title);
    const safeBody = escapeHtml(body);
    const doc = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${safeTitle}</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#faf8f5;color:#2c1810}
  .card{max-width:28rem;padding:2rem;border-radius:1rem;background:#fff;box-shadow:0 8px 32px rgba(78,50,23,.06);text-align:center}
  h1{font-size:1.15rem;font-weight:600;color:${color};margin:0 0 .75rem}
  p{font-size:.9rem;line-height:1.5;color:#5c4a3a;margin:0}
</style></head>
<body><div class="card"><h1>${safeTitle}</h1><p>${safeBody}</p></div></body></html>`;
    return new Response(doc, {
        status: ok ? 200 : 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

serveWithSentry('cafe24-oauth-callback', async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        });
    }
    if (req.method !== 'GET') {
        return htmlPage('오류', 'Method not allowed', false);
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code') ?? '';
    const stateRaw = url.searchParams.get('state') ?? '';
    const errParam = url.searchParams.get('error');
    if (errParam) {
        return htmlPage('연결 취소', `카페24 권한 동의가 취소되었습니다. (${errParam})`, false);
    }
    if (!code || !stateRaw) {
        return htmlPage('오류', 'code 또는 state가 없습니다.', false);
    }

    try {
        const state = await verifyCafe24OAuthState(stateRaw);
        const redirectUri = cafe24RedirectUri();
        const token = await exchangeCafe24Code(state.mallId, code, redirectUri);
        if (!token.access_token) throw new Error('missing access_token');
        if (!token.refresh_token) throw new Error('missing refresh_token — re-authorize with offline access');

        assertCafe24Scopes(token.scopes);

        const secrets = {
            mall_id: state.mallId,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            token_expires_at: tokenExpiresAtMs(token),
            shop_no: token.shop_no != null ? token.shop_no : undefined,
            scopes: normalizeScopes(token.scopes),
        };

        const test = await cafe24Adapter.testConnection(secrets);
        const shopIdentifier = (test.shopIdentifier || state.mallId).toLowerCase();
        const displayName = state.displayName?.trim() || test.displayName || shopIdentifier;

        const admin = serviceClient();
        const now = new Date().toISOString();

        // Workspace owner, not the acting user: rows owned by auth.uid() are
        // invisible to a member's workspace-scoped list (RLS is
        // has_workspace_access(user_id)). Membership was verified in
        // cafe24-oauth-start before the state was HMAC-signed.
        const ownerId = state.ownerId ?? state.userId;

        const { data: existing } = await admin
            .from('sales_channel_connections')
            .select('id')
            .eq('user_id', ownerId)
            .eq('platform', 'cafe24')
            .eq('shop_identifier', shopIdentifier)
            .maybeSingle();

        let connectionId: string;
        if (existing?.id) {
            connectionId = existing.id;
            const { error } = await admin
                .from('sales_channel_connections')
                .update({
                    display_name: displayName,
                    status: 'active',
                    last_error: null,
                    consecutive_failures: 0,
                    updated_at: now,
                })
                .eq('id', connectionId)
                .eq('user_id', ownerId);
            if (error) throw new Error(error.message);
        } else {
            const { data: created, error } = await admin
                .from('sales_channel_connections')
                .insert({
                    user_id: ownerId,
                    platform: 'cafe24',
                    shop_identifier: shopIdentifier,
                    display_name: displayName,
                    status: 'active',
                })
                .select('id')
                .single();
            if (error || !created) throw new Error(error?.message ?? 'connection insert failed');
            connectionId = created.id;
        }

        const { error: secretErr } = await admin.from('sales_channel_secrets').upsert({
            connection_id: connectionId,
            credentials: secrets,
            updated_at: now,
        });
        if (secretErr) throw new Error(secretErr.message);

        return htmlPage(
            '카페24 연결 완료',
            'First Crack 앱으로 돌아가면 채널이 활성화됩니다. 이 창을 닫아도 됩니다.',
            true,
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[cafe24-oauth-callback]', msg);
        if (!STATE_REJECT_RE.test(msg)) {
            await captureEdgeException(e, { function: 'cafe24-oauth-callback' });
        }
        return htmlPage('연결 실패', msg.slice(0, 400), false);
    }
});
