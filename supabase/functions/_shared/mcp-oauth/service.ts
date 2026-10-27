import { type IssuerConfig, MCP_SCOPE } from './config.ts';
import { digest, isOpaque, opaque, pkce } from './crypto.ts';

export type JsonRecord = Record<string, unknown>;
export type Store = { call(action: string, args: JsonRecord): Promise<JsonRecord> };
export type NativeIdentity = { userId: string; workspaces: { owner_id: string; name: string }[] };
export class OAuthFailure extends Error {
    constructor(
        readonly code: string,
        readonly status = 400,
    ) {
        super(code);
    }
}
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class IssuerService {
    constructor(
        readonly config: IssuerConfig,
        private readonly store: Store,
    ) {}
    metadata() {
        const base = this.config.issuer;
        return {
            issuer: base,
            authorization_response_iss_parameter_supported: true,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            revocation_endpoint: `${base}/revoke`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            scopes_supported: [MCP_SCOPE],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            revocation_endpoint_auth_methods_supported: ['none'],
        };
    }
    private async call(action: string, args: JsonRecord) {
        const result = await this.store.call(action, {
            ...args,
            issuer: this.config.issuer,
            resource: this.config.resource,
        });
        if (typeof result.error === 'string')
            throw new OAuthFailure(result.error, typeof result.status === 'number' ? result.status : 400);
        return result;
    }
    private only(params: URLSearchParams, keys: string[]) {
        if ([...params.keys()].some((key) => !keys.includes(key) || params.getAll(key).length !== 1))
            throw new OAuthFailure('invalid_request');
    }
    async authorize(params: URLSearchParams) {
        this.only(params, [
            'client_id',
            'redirect_uri',
            'response_type',
            'scope',
            'state',
            'code_challenge',
            'code_challenge_method',
            'resource',
        ]);
        const redirect = params.get('redirect_uri') ?? '';
        let target: URL;
        try {
            target = new URL(redirect);
        } catch {
            throw new OAuthFailure('invalid_request');
        }
        if (
            target.protocol !== 'https:' ||
            target.username ||
            target.password ||
            target.hash ||
            params.get('response_type') !== 'code' ||
            params.get('scope') !== MCP_SCOPE ||
            params.get('resource') !== this.config.resource ||
            params.get('code_challenge_method') !== 'S256' ||
            !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '') ||
            !(params.get('state') ?? '').length ||
            (params.get('state') ?? '').length > 1024 ||
            !params.get('client_id') ||
            (params.get('client_id') ?? '').length > 128
        )
            throw new OAuthFailure('invalid_request');
        const result = await this.call('start', {
            client_id: params.get('client_id'),
            redirect_uri: redirect,
            state: params.get('state'),
            challenge: params.get('code_challenge'),
        });
        if (typeof result.authorization_id !== 'string' || !idPattern.test(result.authorization_id))
            throw new Error('Invalid issuer storage result');
        const consent = new URL(this.config.consentUrl);
        consent.searchParams.set('authorization_id', result.authorization_id);
        return consent.href;
    }
    async details(id: string, identity: NativeIdentity) {
        if (!idPattern.test(id)) throw new OAuthFailure('invalid_request');
        const result = await this.call('details', { authorization_id: id, user_id: identity.userId });
        return {
            ...result,
            user: { id: identity.userId },
            workspaces: identity.workspaces,
            credential_kind: 'mcp_opaque_v1',
            scope: MCP_SCOPE,
            issuer: this.config.issuer,
            resource: this.config.resource,
        };
    }
    async decide(id: string, decision: string, owner: string | undefined, identity: NativeIdentity) {
        if (!idPattern.test(id) || !['approve', 'deny'].includes(decision)) throw new OAuthFailure('invalid_request');
        if (
            decision === 'approve' &&
            (!owner || !idPattern.test(owner) || !identity.workspaces.some((workspace) => workspace.owner_id === owner))
        )
            throw new OAuthFailure('access_denied', 403);
        const code = opaque('code');
        const result = await this.call(decision, {
            authorization_id: id,
            user_id: identity.userId,
            workspace_owner_id: owner,
            code_hash: await digest(code),
        });
        if (typeof result.redirect_uri !== 'string' || typeof result.state !== 'string')
            throw new Error('Invalid issuer redirect result');
        const target = new URL(result.redirect_uri);
        target.searchParams.set('iss', this.config.issuer);
        target.searchParams.set('state', result.state);
        if (decision === 'approve') target.searchParams.set('code', code);
        else target.searchParams.set('error', 'access_denied');
        return { redirect_url: target.href };
    }
    async token(params: URLSearchParams) {
        const grantType = params.get('grant_type');
        const codeGrant = grantType === 'authorization_code';
        if (!codeGrant && grantType !== 'refresh_token') throw new OAuthFailure('unsupported_grant_type');
        this.only(
            params,
            codeGrant
                ? ['grant_type', 'client_id', 'code', 'redirect_uri', 'code_verifier', 'resource']
                : ['grant_type', 'client_id', 'refresh_token', 'resource', 'scope'],
        );
        if (
            !params.get('client_id') ||
            params.get('resource') !== this.config.resource ||
            (params.has('scope') && params.get('scope') !== MCP_SCOPE)
        )
            throw new OAuthFailure('invalid_request');
        const source = params.get(codeGrant ? 'code' : 'refresh_token') ?? '';
        if (!isOpaque(source, codeGrant ? 'code' : 'rt')) throw new OAuthFailure('invalid_grant');
        const verifier = params.get('code_verifier') ?? '';
        if (codeGrant && !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthFailure('invalid_grant');
        const access = opaque('at');
        const refresh = opaque('rt');
        const result = await this.call(codeGrant ? 'exchange' : 'refresh', {
            client_id: params.get('client_id'),
            source_hash: await digest(source),
            redirect_uri: params.get('redirect_uri'),
            challenge: codeGrant ? await pkce(verifier) : undefined,
            access_hash: await digest(access),
            refresh_hash: await digest(refresh),
        });
        if (typeof result.expires_in !== 'number') throw new Error('Invalid token lifetime');
        return {
            access_token: access,
            token_type: 'Bearer',
            expires_in: result.expires_in,
            refresh_token: refresh,
            scope: MCP_SCOPE,
        };
    }
    async revoke(params: URLSearchParams) {
        this.only(params, ['client_id', 'token', 'token_type_hint']);
        const token = params.get('token') ?? '';
        if (!params.get('client_id')) throw new OAuthFailure('invalid_request');
        if (isOpaque(token, 'at') || isOpaque(token, 'rt'))
            await this.call('revoke', { client_id: params.get('client_id'), source_hash: await digest(token) });
    }
    async grants(identity: NativeIdentity) {
        const result = await this.call('grants', { user_id: identity.userId });
        if (!Array.isArray(result.grants)) throw new Error('Invalid grant list');
        return {
            grants: result.grants.map((grant) => ({
                ...grant,
                workspace_name:
                    identity.workspaces.find((workspace) => workspace.owner_id === grant.workspace_owner_id)?.name ??
                    'Unavailable workspace',
            })),
        };
    }
    async revokeGrant(id: string, identity: NativeIdentity) {
        if (!idPattern.test(id)) throw new OAuthFailure('invalid_request');
        return this.call('revoke_grant', { grant_id: id, user_id: identity.userId });
    }
}
