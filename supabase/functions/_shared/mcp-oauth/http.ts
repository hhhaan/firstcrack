import { type IssuerService, type NativeIdentity, OAuthFailure } from './service.ts';

async function bodyText(req: Request) {
    const reader = req.body?.getReader();
    if (!reader) throw new OAuthFailure('invalid_request');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > 16384) {
                await reader.cancel();
                throw new OAuthFailure('invalid_request', 413);
            }
            chunks.push(part.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
export function createIssuerHandler(deps: {
    service: IssuerService | null;
    identity(req: Request): Promise<NativeIdentity | null>;
}) {
    return async (req: Request): Promise<Response> => {
        const headers = new Headers({
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
            Vary: 'Origin',
            'Referrer-Policy': 'no-referrer',
        });
        const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
        const service = deps.service;
        if (!service) return json({ error: 'temporarily_unavailable' }, 503);
        const origin = req.headers.get('Origin');
        if (
            origin &&
            origin !== new URL(service.config.issuer).origin &&
            !service.config.allowedOrigins.includes(origin)
        )
            return json({ error: 'access_denied' }, 403);
        if (origin) headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        const url = new URL(req.url);
        const prefixes = [
            new URL(service.config.issuer).pathname,
            '/functions/v1/firstcrack-oauth',
            '/firstcrack-oauth',
        ];
        const prefix = prefixes.find((value) => url.pathname.startsWith(`${value}/`));
        const path = prefix ? url.pathname.slice(prefix.length) : '';
        try {
            if (path === '/metadata' && req.method === 'GET') return json(service.metadata());
            if (path === '/authorize' && req.method === 'GET')
                return new Response(null, {
                    status: 303,
                    headers: new Headers([...headers, ['Location', await service.authorize(url.searchParams)]]),
                });
            if (['/token', '/revoke'].includes(path) && req.method === 'POST') {
                if (
                    req.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded' ||
                    req.headers.has('Authorization')
                )
                    throw new OAuthFailure('invalid_request');
                const params = new URLSearchParams(await bodyText(req));
                if (path === '/token') return json(await service.token(params));
                await service.revoke(params);
                return json({});
            }
            if (!['/details', '/decision', '/grants', '/revoke-grant'].includes(path))
                return json({ error: 'invalid_request' }, 404);
            if (path === '/details' || path === '/grants' ? req.method !== 'GET' : req.method !== 'POST')
                return json({ error: 'invalid_request' }, 405);
            const identity = await deps.identity(req);
            if (!identity) return json({ error: 'access_denied' }, 401);
            if (path === '/details')
                return json(await service.details(url.searchParams.get('authorization_id') ?? '', identity));
            if (path === '/grants') return json(await service.grants(identity));
            if (req.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
                throw new OAuthFailure('invalid_request');
            let body: unknown;
            try {
                body = JSON.parse(await bodyText(req));
            } catch (error) {
                if (error instanceof OAuthFailure) throw error;
                throw new OAuthFailure('invalid_request');
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthFailure('invalid_request');
            const args = body as Record<string, unknown>;
            const allowed =
                path === '/decision' ? ['authorization_id', 'decision', 'workspace_owner_id'] : ['grant_id'];
            if (Object.keys(args).some((key) => !allowed.includes(key))) throw new OAuthFailure('invalid_request');
            if (path === '/revoke-grant') return json(await service.revokeGrant(String(args.grant_id ?? ''), identity));
            if (args.workspace_owner_id !== undefined && typeof args.workspace_owner_id !== 'string')
                throw new OAuthFailure('invalid_request');
            return json(
                await service.decide(
                    String(args.authorization_id ?? ''),
                    String(args.decision ?? ''),
                    args.workspace_owner_id as string | undefined,
                    identity,
                ),
            );
        } catch (error) {
            if (error instanceof OAuthFailure) return json({ error: error.code }, error.status);
            throw error; // Existing serveWithSentry captures unexpected backend failures once.
        }
    };
}
