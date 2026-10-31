const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const CLIENT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

type ClientDocument = {
    jwks_uri?: unknown;
    token_endpoint_auth_method?: unknown;
    token_endpoint_auth_methods_supported?: unknown;
};
type Claims = { iss?: unknown; sub?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown };
type RsaJwk = JsonWebKey & { kid?: string };

function bytes(value: string): Uint8Array<ArrayBuffer> {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}
function json(segment: string): Record<string, unknown> {
    return JSON.parse(new TextDecoder().decode(bytes(segment)));
}
function httpsUrl(value: string, hosts: Set<string>): URL | null {
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !hosts.has(url.hostname)
        )
            return null;
        return url;
    } catch {
        return null;
    }
}

/** Returns invalid_client when a ChatGPT private_key_jwt assertion is present and fails. Absent means public PKCE. */
export async function privateKeyJwtError(
    params: URLSearchParams,
    audiences: string[],
    fetcher: typeof fetch = fetch,
    now = Date.now(),
): Promise<'invalid_client' | null> {
    const assertion = params.get('client_assertion');
    const type = params.get('client_assertion_type');
    if (!assertion && !type) return null;
    if (type !== ASSERTION_TYPE || !assertion) return 'invalid_client';
    const clientId = params.get('client_id') ?? '';
    const clientUrl = httpsUrl(clientId, CLIENT_HOSTS);
    if (!clientUrl) return 'invalid_client';
    const parts = assertion.split('.');
    if (parts.length !== 3) return 'invalid_client';
    let header: Record<string, unknown>;
    let claims: Claims;
    try {
        header = json(parts[0]);
        claims = json(parts[1]);
    } catch {
        return 'invalid_client';
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return 'invalid_client';
    const seconds = now / 1000;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
        claims.iss !== clientId ||
        claims.sub !== clientId ||
        !audience.some((value) => audiences.includes(String(value))) ||
        typeof claims.exp !== 'number' ||
        claims.exp <= seconds - 60 ||
        claims.exp > seconds + 600 ||
        (typeof claims.nbf === 'number' && claims.nbf > seconds + 60)
    )
        return 'invalid_client';
    try {
        const document = (await (await fetcher(clientUrl)).json()) as ClientDocument;
        const methods = [
            document.token_endpoint_auth_method,
            ...(Array.isArray(document.token_endpoint_auth_methods_supported)
                ? document.token_endpoint_auth_methods_supported
                : []),
        ];
        const jwksUrl = typeof document.jwks_uri === 'string' ? httpsUrl(document.jwks_uri, CLIENT_HOSTS) : null;
        if (!methods.includes('private_key_jwt') || !jwksUrl) return 'invalid_client';
        const jwks = (await (await fetcher(jwksUrl)).json()) as { keys?: RsaJwk[] };
        const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA');
        if (!jwk) return 'invalid_client';
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
            'verify',
        ]);
        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            bytes(parts[2]),
            new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        );
        return valid ? null : 'invalid_client';
    } catch {
        return 'invalid_client';
    }
}
