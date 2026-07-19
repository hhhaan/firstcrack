/**
 * Cafe24 OAuth helpers — official Authorization Code flow.
 * https://developers.cafe24.com/docs-new/en/docs/guide/oauth2-authentication
 */

export const CAFE24_SCOPES = [
    'mall.read_store',
    'mall.read_order',
    'mall.write_order',
    'mall.read_product',
] as const;

export const CAFE24_REQUIRED_SCOPES = ['mall.read_order', 'mall.write_order', 'mall.read_store'] as const;

export function cafe24AppCredentials(): { clientId: string; clientSecret: string } {
    const clientId = (Deno.env.get('CAFE24_CLIENT_ID') ?? '').trim();
    const clientSecret = (Deno.env.get('CAFE24_CLIENT_SECRET') ?? '').trim();
    if (!clientId || !clientSecret) {
        throw new Error('CAFE24_CLIENT_ID and CAFE24_CLIENT_SECRET must be set');
    }
    return { clientId, clientSecret };
}

export function cafe24RedirectUri(): string {
    const explicit = (Deno.env.get('CAFE24_REDIRECT_URI') ?? '').trim();
    if (explicit) return explicit;
    const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
    if (!base) throw new Error('CAFE24_REDIRECT_URI or SUPABASE_URL required');
    return `${base}/functions/v1/cafe24-oauth-callback`;
}

function stateSecret(): string {
    return (
        (Deno.env.get('CAFE24_OAUTH_STATE_SECRET') ?? '').trim() ||
        (Deno.env.get('CAFE24_CLIENT_SECRET') ?? '').trim()
    );
}

function b64url(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
    return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSha256(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return b64url(new Uint8Array(sig));
}

export type Cafe24OAuthState = {
    userId: string;
    mallId: string;
    displayName?: string;
    nonce: string;
    exp: number;
};

export async function signCafe24OAuthState(state: Cafe24OAuthState): Promise<string> {
    const secret = stateSecret();
    if (!secret) throw new Error('CAFE24_OAUTH_STATE_SECRET or CAFE24_CLIENT_SECRET required for state');
    const payload = b64urlJson(state);
    const sig = await hmacSha256(secret, payload);
    return `${payload}.${sig}`;
}

export async function verifyCafe24OAuthState(raw: string): Promise<Cafe24OAuthState> {
    const secret = stateSecret();
    if (!secret) throw new Error('state secret not configured');
    const [payload, sig] = raw.split('.');
    if (!payload || !sig) throw new Error('invalid state');
    const expected = await hmacSha256(secret, payload);
    if (expected !== sig) throw new Error('invalid state signature');

    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Cafe24OAuthState;
    if (!json.userId || !json.mallId || !json.exp) throw new Error('invalid state payload');
    if (Date.now() > json.exp) throw new Error('state expired');
    return {
        userId: String(json.userId),
        mallId: String(json.mallId).trim().toLowerCase(),
        displayName: json.displayName ? String(json.displayName) : undefined,
        nonce: String(json.nonce ?? ''),
        exp: Number(json.exp),
    };
}

export function buildCafe24AuthorizeUrl(mallId: string, clientId: string, redirectUri: string, state: string): string {
    const url = new URL(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', CAFE24_SCOPES.join(' '));
    return url.toString();
}

export type Cafe24TokenResponse = {
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    expires_in?: number;
    scopes?: string[] | string;
    mall_id?: string;
    shop_no?: string | number;
};

export function normalizeScopes(scopes: string[] | string | undefined): string[] {
    if (Array.isArray(scopes)) return scopes.map(String);
    if (typeof scopes === 'string') return scopes.split(/[\s,]+/).filter(Boolean);
    return [];
}

export async function exchangeCafe24Code(
    mallId: string,
    code: string,
    redirectUri: string,
): Promise<Cafe24TokenResponse> {
    const { clientId, clientSecret } = cafe24AppCredentials();
    const basic = btoa(`${clientId}:${clientSecret}`);
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
    });
    const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    if (!res.ok) {
        throw new Error(`cafe24 token ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    return (await res.json()) as Cafe24TokenResponse;
}

export function tokenExpiresAtMs(json: Cafe24TokenResponse): number | undefined {
    if (json.expires_in != null) return Date.now() + Number(json.expires_in) * 1000;
    if (json.expires_at) {
        const t = Date.parse(json.expires_at);
        return Number.isFinite(t) ? t : undefined;
    }
    return undefined;
}

export function assertCafe24Scopes(scopes: string[] | string | undefined): void {
    const list = normalizeScopes(scopes);
    // Some token responses omit scopes; still require list when present.
    if (!list.length) return;
    const set = new Set(list.map((s) => s.trim()));
    const missing = CAFE24_REQUIRED_SCOPES.filter((s) => !set.has(s));
    if (missing.length) {
        throw new Error(`missing scopes: ${missing.join(', ')}`);
    }
}

export function normalizeMallId(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\.cafe24\.com.*$/, '')
        .replace(/\.cafe24api\.com.*$/, '')
        .replace(/\/$/, '');
}
