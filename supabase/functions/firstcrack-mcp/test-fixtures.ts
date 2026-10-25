import type { McpConfig } from './auth.ts';

export const config: McpConfig = {
    resource: 'https://project.example/functions/v1/firstcrack-mcp',
    issuer: 'https://project.example/auth/v1',
    clientIds: ['approved-client'],
    allowedOrigins: ['https://host.example'],
};
export const memberId = '11111111-1111-4111-8111-111111111111';
export const ownerId = '22222222-2222-4222-8222-222222222222';
export const otherOwnerId = '33333333-3333-4333-8333-333333333333';
export const validClaims = () => ({
    iss: config.issuer,
    aud: config.resource,
    sub: memberId,
    role: 'firstcrack_reader',
    client_id: 'approved-client',
    scope: 'firstcrack:read',
    firstcrack_workspace_owner_id: ownerId,
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000) - 10,
});
