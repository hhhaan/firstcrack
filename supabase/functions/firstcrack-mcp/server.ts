import { authorizeClaims, bearerChallenge, type McpConfig, READ_SCOPE, type VerifiedClaims } from './auth.ts';
import { BackendFailure, InvalidArguments, type ReadClient, readTool, ToolFailure, tools } from './data.ts';

const VERSIONS = ['2025-06-18', '2025-03-26'];
const MAX_BODY_BYTES = 65536;
type Dependencies = {
    config: McpConfig | null;
    /** Must validate an opaque credential against its current grant; native JWTs are rejected. */
    verify: (req: Request, token: string) => Promise<VerifiedClaims | null>;
    userClient: (req: Request) => ReadClient;
    reportError: (error: unknown) => Promise<void>;
};

async function parseBody(req: Request): Promise<unknown> {
    const reader = req.body?.getReader();
    if (!reader) throw new SyntaxError('Missing body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_BODY_BYTES) {
                await reader.cancel();
                throw new RangeError('Request too large');
            }
            chunks.push(chunk.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

/** Stateless Streamable HTTP: JSON POST responses; no SSE or persistent sessions. */
export function createMcpHandler(deps: Dependencies) {
    return async (req: Request): Promise<Response> => {
        const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
        const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
        const config = deps.config;
        if (!config) return json({ error: 'Firstcrack connection is not enabled' }, 503);

        const origin = req.headers.get('Origin');
        if (origin && !config.allowedOrigins.includes(origin)) return json({ error: 'Origin not allowed' }, 403);
        if (origin) headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
        headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate');
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

        const pathname = new URL(req.url).pathname;
        const resourcePath = new URL(config.resource).pathname;
        // The Supabase gateway may remove /functions/v1 before forwarding to the worker.
        const basePaths = [resourcePath, resourcePath.replace(/^\/functions\/v1(?=\/)/, '')];
        const metadataPaths = basePaths.map((path) => `${path}/.well-known/oauth-protected-resource`);
        if (metadataPaths.includes(pathname) && req.method === 'GET') {
            return json({
                resource: config.resource,
                resource_name: 'Firstcrack read-only',
                authorization_servers: [config.issuer],
                scopes_supported: [READ_SCOPE],
                bearer_methods_supported: ['header'],
            });
        }
        if (!basePaths.some((path) => pathname === path || pathname === `${path}/`))
            return json({ error: 'Not found' }, 404);

        const match = /^Bearer ([^\s,]+)$/i.exec(req.headers.get('Authorization') ?? '');
        if (!match || match[1].length > 8192) {
            headers.set('WWW-Authenticate', bearerChallenge(config));
            return json({ error: 'Authentication required' }, 401);
        }
        const claims = await deps.verify(req, match[1]);
        const auth = claims
            ? authorizeClaims(claims, config)
            : { status: 401 as const, error: 'invalid_token' as const };
        if ('error' in auth) {
            headers.set('WWW-Authenticate', bearerChallenge(config, auth.error));
            return json({ error: auth.error }, auth.status);
        }
        if (req.method !== 'POST') {
            headers.set('Allow', 'POST, OPTIONS');
            return json({ error: 'Method not allowed' }, 405);
        }
        const accept = req.headers.get('Accept') ?? '';
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
            return json({ error: 'Accept application/json and text/event-stream' }, 406);
        }
        if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
            return json({ error: 'Content-Type must be application/json' }, 415);
        }
        const version = req.headers.get('MCP-Protocol-Version');
        if (version && !VERSIONS.includes(version)) return json({ error: 'Unsupported MCP protocol version' }, 400);

        let body: unknown;
        try {
            body = await parseBody(req);
        } catch (error) {
            return json(
                { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON request' } },
                error instanceof RangeError ? 413 : 400,
            );
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400);
        }
        const message = body as Record<string, unknown>;
        const { id, method, params } = message;
        const hasId = Object.hasOwn(message, 'id');
        if (
            message.jsonrpc !== '2.0' ||
            typeof method !== 'string' ||
            (hasId && id !== null && typeof id !== 'string' && !(typeof id === 'number' && Number.isSafeInteger(id))) ||
            (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params)))
        ) {
            return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400);
        }
        // Notifications never execute tools or return JSON-RPC responses.
        if (!hasId) return new Response(null, { status: 202, headers });
        const result = (value: unknown) => json({ jsonrpc: '2.0', id, result: value });
        const failure = (code: number, message: string) => json({ jsonrpc: '2.0', id, error: { code, message } });
        const args = (params ?? {}) as Record<string, unknown>;
        switch (method) {
            case 'initialize':
                if (typeof args.protocolVersion !== 'string') return failure(-32602, 'protocolVersion required');
                return result({
                    protocolVersion: VERSIONS.includes(args.protocolVersion) ? args.protocolVersion : VERSIONS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'firstcrack-read-only', version: '0.1.0' },
                    instructions:
                        '로그인한 사용자의 허용된 로스터리 정보만 조회합니다. 조회 실패를 샘플 데이터로 대체하지 마세요.',
                });
            case 'ping':
                return result({});
            case 'tools/list':
                return result({ tools });
            case 'tools/call': {
                if (typeof args.name !== 'string') return failure(-32602, 'Tool name required');
                try {
                    const output = await readTool(deps.userClient(req), auth.principal, args.name, args.arguments);
                    return result({
                        content: [{ type: 'text', text: JSON.stringify(output) }],
                        structuredContent: output,
                    });
                } catch (error) {
                    if (error instanceof InvalidArguments) return failure(-32602, error.message);
                    if (!(error instanceof ToolFailure)) throw error;
                    if (error instanceof BackendFailure) await deps.reportError(error.detail);
                    return result({ isError: true, content: [{ type: 'text', text: error.message }] });
                }
            }
            default:
                return failure(-32601, 'Method not found');
        }
    };
}
