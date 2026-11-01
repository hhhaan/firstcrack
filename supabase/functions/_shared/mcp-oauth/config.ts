export const MCP_SCOPE = 'firstcrack:read';
export const MCP_WRITE_SCOPE = 'firstcrack:write';
export const MCP_WRITE_SCOPES = `${MCP_SCOPE} ${MCP_WRITE_SCOPE}`;
export type IssuerConfig = {
    issuer: string;
    resource: string;
    consentUrl: string;
    allowedOrigins: string[];
    writeEnabled?: boolean;
};
export function readIssuerConfig(env: (name: string) => string | undefined): IssuerConfig | null {
    if (env('FIRSTCRACK_OAUTH_ENABLED') !== 'true' || !env('FIRSTCRACK_OAUTH_DATABASE_URL')) return null;
    try {
        const issuer = new URL(env('FIRSTCRACK_MCP_ISSUER_URL') ?? '');
        const resource = new URL(env('FIRSTCRACK_MCP_RESOURCE_URL') ?? '');
        const consent = new URL(env('FIRSTCRACK_OAUTH_CONSENT_URL') ?? '');
        const allowedOrigins = (env('FIRSTCRACK_MCP_ALLOWED_ORIGINS') ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
        for (const url of [issuer, resource, consent]) {
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        }
        if (
            issuer.pathname !== '/oauth/mcp' ||
            consent.pathname !== '/oauth/consent' ||
            consent.origin !== issuer.origin ||
            allowedOrigins.some((origin) => new URL(origin).origin !== origin || !origin.startsWith('https://'))
        )
            return null;
        return {
            issuer: issuer.href.replace(/\/$/, ''),
            resource: resource.href.replace(/\/$/, ''),
            consentUrl: consent.href,
            allowedOrigins,
            ...(env('FIRSTCRACK_OAUTH_WRITE_ENABLED') === 'true' ? { writeEnabled: true } : {}),
        };
    } catch {
        return null;
    }
}
