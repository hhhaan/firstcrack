export const READ_SCOPE = 'firstcrack:read';
export const READER_ROLE = 'firstcrack_reader';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type McpConfig = {
    resource: string;
    issuer: string;
    clientIds: string[];
    allowedOrigins: string[];
};

/** Disabled until a reviewed OAuth issuer, resource and client registration are ready. */
export function readMcpConfig(env: (key: string) => string | undefined): McpConfig | null {
    if (env('FIRSTCRACK_MCP_ENABLED') !== 'true') return null;
    try {
        const resource = new URL(env('FIRSTCRACK_MCP_RESOURCE_URL') ?? '');
        const project = new URL(env('SUPABASE_URL') ?? '');
        const clientIds = (env('FIRSTCRACK_MCP_CLIENT_IDS') ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        const allowedOrigins = (env('FIRSTCRACK_MCP_ALLOWED_ORIGINS') ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);
        for (const url of [resource, project]) {
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        }
        if (project.pathname !== '/' || clientIds.length === 0) return null;
        if (allowedOrigins.some((origin) => new URL(origin).origin !== origin || !origin.startsWith('https://'))) {
            return null;
        }
        return {
            resource: resource.href.replace(/\/$/, ''),
            issuer: `${project.origin}/auth/v1`,
            clientIds,
            allowedOrigins,
        };
    } catch {
        return null;
    }
}

export type VerifiedClaims = Record<string, unknown>;
export type Principal = { userId: string; clientId: string; workspaceOwnerId: string };
export type AuthResult =
    | { principal: Principal }
    | { status: 401 | 403; error: 'invalid_token' | 'insufficient_scope' };

/** Only call with claims returned by a cryptographic verifier, never a decoded JWT. */
export function authorizeClaims(claims: VerifiedClaims, config: McpConfig, now = Date.now() / 1000): AuthResult {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
        claims.iss !== config.issuer ||
        !audiences.includes(config.resource) ||
        typeof claims.sub !== 'string' ||
        !UUID.test(claims.sub) ||
        claims.role !== READER_ROLE ||
        typeof claims.firstcrack_workspace_owner_id !== 'string' ||
        !UUID.test(claims.firstcrack_workspace_owner_id) ||
        claims.is_anonymous === true ||
        typeof claims.exp !== 'number' ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= now ||
        typeof claims.iat !== 'number' ||
        !Number.isFinite(claims.iat) ||
        claims.iat > now + 30 ||
        claims.exp <= claims.iat ||
        (claims.nbf !== undefined &&
            (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now)) ||
        typeof claims.client_id !== 'string' ||
        !config.clientIds.includes(claims.client_id)
    )
        return { status: 401, error: 'invalid_token' };

    if (typeof claims.scope !== 'string' || !claims.scope.split(/\s+/).includes(READ_SCOPE)) {
        return { status: 403, error: 'insufficient_scope' };
    }
    return {
        principal: {
            userId: claims.sub,
            clientId: claims.client_id,
            workspaceOwnerId: claims.firstcrack_workspace_owner_id,
        },
    };
}

export const metadataUrl = (config: McpConfig) => `${config.resource}/.well-known/oauth-protected-resource`;

export function bearerChallenge(config: McpConfig, error?: string): string {
    return `Bearer resource_metadata="${metadataUrl(config)}", scope="${READ_SCOPE}"${error ? `, error="${error}"` : ''}`;
}
