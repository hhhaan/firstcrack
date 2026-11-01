import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type IssuerConfig, MCP_SCOPE, MCP_WRITE_SCOPES, readIssuerConfig } from './config.ts';
import { opaque } from './crypto.ts';
import { createIssuerHandler } from './http.ts';
import { IssuerService, type JsonRecord } from './service.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const authorizationId = '33333333-3333-4333-8333-333333333333';
const config: IssuerConfig = {
    issuer: 'https://identity.example/oauth/mcp',
    resource: 'https://resource.example/mcp',
    consentUrl: 'https://identity.example/oauth/consent',
    allowedOrigins: [],
    writeEnabled: true,
};
const identity = { userId, workspaces: [{ owner_id: ownerId, name: 'Roastery' }] };
const call = vi.fn(async (_action: string, _args: JsonRecord): Promise<JsonRecord> => ({}));
const service = new IssuerService(config, { call });
const authorizeParams = (scope = MCP_WRITE_SCOPES) =>
    new URLSearchParams({
        client_id: 'approved-client',
        redirect_uri: 'https://host.example/callback',
        response_type: 'code',
        scope,
        state: 'fixture-state',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
        resource: config.resource,
    });
beforeEach(() => vi.clearAllMocks());

describe('explicit new inventory and production consent', () => {
    it('keeps both independent write gates disabled unless set exactly true', () => {
        const env: Record<string, string> = {
            FIRSTCRACK_OAUTH_ENABLED: 'true',
            FIRSTCRACK_OAUTH_DATABASE_URL: 'fixture',
            FIRSTCRACK_MCP_ISSUER_URL: config.issuer,
            FIRSTCRACK_MCP_RESOURCE_URL: config.resource,
            FIRSTCRACK_OAUTH_CONSENT_URL: config.consentUrl,
        };
        expect(readIssuerConfig((key) => env[key])?.writeEnabled).toBeUndefined();
        env.FIRSTCRACK_OAUTH_WRITE_ENABLED = 'true';
        expect(readIssuerConfig((key) => env[key])?.writeEnabled).toBe(true);
    });
    it('does not advertise or accept writes without the issuer gate', async () => {
        const disabled = new IssuerService({ ...config, writeEnabled: false }, { call });
        expect(disabled.metadata().scopes_supported).toEqual([MCP_SCOPE]);
        await expect(disabled.authorize(authorizeParams())).rejects.toMatchObject({ code: 'invalid_scope' });
        expect(call).not.toHaveBeenCalled();
    });
    it('stores the explicit requested scope and returns its pending authorization', async () => {
        call.mockResolvedValue({ authorization_id: authorizationId });
        await expect(service.authorize(authorizeParams())).resolves.toContain(authorizationId);
        expect(call).toHaveBeenCalledWith('start', expect.objectContaining({ scope: MCP_WRITE_SCOPES }));
        call.mockClear();
        await service.authorize(authorizeParams(MCP_SCOPE));
        expect(call).toHaveBeenCalledWith('start', expect.objectContaining({ scope: MCP_SCOPE }));
    });
    it('shows the stored scope instead of inventing write consent', async () => {
        call.mockResolvedValue({ scope: MCP_WRITE_SCOPES });
        expect(await service.details(authorizationId, identity)).toMatchObject({ scope: MCP_WRITE_SCOPES });
        call.mockResolvedValue({ scope: 'firstcrack:admin' });
        await expect(service.details(authorizationId, identity)).rejects.toMatchObject({ code: 'invalid_scope' });
    });
    it('defaults approval to read-only and forwards explicit write approval separately', async () => {
        call.mockResolvedValue({ redirect_uri: 'https://host.example/callback', state: 'fixture' });
        await service.decide(authorizationId, 'approve', ownerId, identity);
        expect(call).toHaveBeenCalledWith('approve', expect.objectContaining({ allow_write: false }));
        await service.decide(authorizationId, 'approve', ownerId, identity, true);
        expect(call).toHaveBeenLastCalledWith('approve', expect.objectContaining({ allow_write: true }));
    });
    it('rejects write approval if the issuer gate has been disabled', async () => {
        await expect(
            new IssuerService({ ...config, writeEnabled: false }, { call }).decide(
                authorizationId,
                'approve',
                ownerId,
                identity,
                true,
            ),
        ).rejects.toMatchObject({ code: 'access_denied' });
        expect(call).not.toHaveBeenCalled();
    });
    it('returns only the stored token scope and asks storage to enforce refresh scope restrictions', async () => {
        call.mockResolvedValue({ expires_in: 600, scope: MCP_SCOPE });
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'approved-client',
            refresh_token: opaque('rt'),
            resource: config.resource,
        });
        expect(await service.token(params)).toMatchObject({ scope: MCP_SCOPE });
        expect(call).toHaveBeenLastCalledWith('refresh', expect.not.objectContaining({ scope: expect.anything() }));
        params.set('scope', MCP_WRITE_SCOPES);
        call.mockResolvedValue({ error: 'invalid_scope' });
        await expect(service.token(params)).rejects.toMatchObject({ code: 'invalid_scope' });
        expect(call).toHaveBeenLastCalledWith('refresh', expect.objectContaining({ scope: MCP_WRITE_SCOPES }));
    });
    it('can refresh an existing write grant after activation is disabled without expanding its stored scope', async () => {
        const disabled = new IssuerService({ ...config, writeEnabled: false }, { call });
        call.mockResolvedValue({ expires_in: 600, scope: MCP_WRITE_SCOPES });
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'approved-client',
            refresh_token: opaque('rt'),
            resource: config.resource,
        });
        expect(await disabled.token(params)).toMatchObject({ scope: MCP_WRITE_SCOPES });
        params.set('scope', MCP_WRITE_SCOPES);
        expect(await disabled.token(params)).toMatchObject({ scope: MCP_WRITE_SCOPES });
        expect(call).toHaveBeenLastCalledWith('refresh', expect.objectContaining({ scope: MCP_WRITE_SCOPES }));
    });
    it.each([null, 'firstcrack:admin', 'firstcrack:write'])(
        'rejects malformed stored scope instead of substituting read consent: %j',
        async (scope) => {
            call.mockResolvedValue({ scope, expires_in: 600 });
            await expect(service.details(authorizationId, identity)).rejects.toMatchObject({ code: 'invalid_scope' });
            await expect(
                service.token(
                    new URLSearchParams({
                        grant_type: 'refresh_token',
                        client_id: 'approved-client',
                        refresh_token: opaque('rt'),
                        resource: config.resource,
                    }),
                ),
            ).rejects.toMatchObject({ code: 'invalid_scope' });
        },
    );
    it('rejects non-boolean approval inputs before storage', async () => {
        const handler = createIssuerHandler({ service, identity: async () => identity });
        for (const allow_write of ['true', 1, null, {}]) {
            const response = await handler(
                new Request(`${config.issuer}/decision`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        authorization_id: authorizationId,
                        workspace_owner_id: ownerId,
                        decision: 'approve',
                        allow_write,
                    }),
                }),
            );
            expect(response.status).toBe(400);
        }
        expect(call).not.toHaveBeenCalled();
    });
});
