import { describe, expect, it } from 'vitest';
import { readIssuerConfig } from './config.ts';

describe('independent issuer activation boundary', () => {
    const env: Record<string, string> = {
        FIRSTCRACK_OAUTH_ENABLED: 'true',
        FIRSTCRACK_OAUTH_DATABASE_URL: 'local-fixture-placeholder',
        FIRSTCRACK_MCP_ISSUER_URL: 'https://identity.example/oauth/mcp',
        FIRSTCRACK_MCP_RESOURCE_URL: 'https://resource.example/mcp',
        FIRSTCRACK_OAUTH_CONSENT_URL: 'https://identity.example/oauth/consent',
    };
    it('requires explicit enabled configuration', () => {
        expect(readIssuerConfig(() => undefined)).toBeNull();
        expect(readIssuerConfig((name) => env[name])?.issuer).toBe(env.FIRSTCRACK_MCP_ISSUER_URL);
    });
    it.each([
        { FIRSTCRACK_OAUTH_ENABLED: 'false' },
        { FIRSTCRACK_OAUTH_DATABASE_URL: '' },
        { FIRSTCRACK_MCP_ISSUER_URL: 'https://native.example/auth/v1' },
        { FIRSTCRACK_MCP_ISSUER_URL: 'https://identity.example/oauth/mcp?token=fixture' },
        { FIRSTCRACK_OAUTH_CONSENT_URL: 'https://attacker.example/oauth/consent' },
        { FIRSTCRACK_OAUTH_CONSENT_URL: 'https://identity.example/auth/callback' },
        { FIRSTCRACK_MCP_RESOURCE_URL: 'http://resource.example/mcp' },
    ])('rejects unsafe or native-issuer configuration: %j', (change) => {
        const values = { ...env, ...change };
        expect(readIssuerConfig((name) => values[name])).toBeNull();
    });
});
