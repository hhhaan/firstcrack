import { describe, expect, it } from 'vitest';
import { authorizeClaims, readMcpConfig } from './auth.ts';
import { config, memberId, ownerId, validClaims } from './test-fixtures.ts';

describe('verified token policy', () => {
    it('accepts only a verified read credential bound to a selected workspace', () => {
        expect(authorizeClaims(validClaims(), config)).toEqual({
            principal: { userId: memberId, clientId: 'approved-client', workspaceOwnerId: ownerId },
        });
    });

    it.each([
        { iss: 'https://another-project.example/auth/v1' },
        { aud: 'authenticated' },
        { exp: 1 },
        { exp: Number.NaN },
        { iat: Date.now() / 1000 + 1000 },
        { nbf: Date.now() / 1000 + 1000 },
        { sub: 'not-a-user' },
        { role: 'service_role' },
        { role: 'authenticated' },
        { client_id: 'unapproved-client' },
        { client_id: undefined },
        { is_anonymous: true },
        { firstcrack_workspace_owner_id: undefined },
        { firstcrack_workspace_owner_id: 'invalid' },
    ])('rejects invalid or unrestricted credentials: %j', (change) => {
        expect(authorizeClaims({ ...validClaims(), ...change }, config)).toEqual({
            status: 401,
            error: 'invalid_token',
        });
    });

    it.each(['', 'openid profile', 'firstcrack:read-write', undefined])('rejects an absent read scope: %s', (scope) => {
        expect(authorizeClaims({ ...validClaims(), scope }, config)).toEqual({
            status: 403,
            error: 'insufficient_scope',
        });
    });

    it('never uses user-editable metadata for permissions or workspace scope', () => {
        expect(
            authorizeClaims(
                { ...validClaims(), scope: undefined, user_metadata: { scope: 'firstcrack:read' } },
                config,
            ),
        ).toEqual({ status: 403, error: 'insufficient_scope' });
    });
});

describe('activation configuration', () => {
    const env = {
        FIRSTCRACK_MCP_ENABLED: 'true',
        FIRSTCRACK_MCP_RESOURCE_URL: config.resource,
        SUPABASE_URL: 'https://project.example',
        FIRSTCRACK_MCP_CLIENT_IDS: 'approved-client',
        FIRSTCRACK_MCP_ALLOWED_ORIGINS: 'https://host.example',
    };
    it('defaults to disabled and requires explicit valid configuration', () => {
        expect(readMcpConfig(() => undefined)).toBeNull();
        expect(readMcpConfig((key) => env[key as keyof typeof env])).toEqual(config);
    });
    it.each([
        { FIRSTCRACK_MCP_ENABLED: 'false' },
        { FIRSTCRACK_MCP_CLIENT_IDS: '' },
        { FIRSTCRACK_MCP_RESOURCE_URL: 'http://insecure.example/mcp' },
        { FIRSTCRACK_MCP_RESOURCE_URL: 'https://user:password@project.example/mcp' },
        { FIRSTCRACK_MCP_RESOURCE_URL: `${config.resource}?token=unsafe` },
        { SUPABASE_URL: 'https://project.example/untrusted/path' },
        { FIRSTCRACK_MCP_ALLOWED_ORIGINS: '*' },
        { FIRSTCRACK_MCP_ALLOWED_ORIGINS: 'https://host.example/some-path' },
    ])('fails closed for incomplete configuration: %j', (change) => {
        const values = { ...env, ...change };
        expect(readMcpConfig((key) => values[key as keyof typeof values])).toBeNull();
    });
});
