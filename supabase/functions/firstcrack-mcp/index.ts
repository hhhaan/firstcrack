import { createUserClient } from '../_shared/auth.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';
import { readMcpConfig } from './auth.ts';
import { createMcpHandler } from './server.ts';
import { verifySupabaseToken } from './verify.ts';

const handler = createMcpHandler({
    config: readMcpConfig((key) => Deno.env.get(key)),
    userClient: (req) => {
        const client = createUserClient(req);
        return {
            hasWorkspaceAccess: async (ownerId) => {
                const { data, error } = await client.rpc('has_workspace_access', { target_owner: ownerId });
                return { data, error };
            },
            selectRows: async ({ table, columns, ownerColumn, ownerId, offset, limit }) => {
                const { data, error } = await client
                    .from(table)
                    .select(columns)
                    .eq(ownerColumn, ownerId)
                    .order('id', { ascending: true })
                    .range(offset, offset + limit);
                return { data, error };
            },
        };
    },
    verify: (req, token) => verifySupabaseToken(createUserClient(req).auth, token),
    reportError: (error) => captureEdgeException(error, { function: 'firstcrack-mcp', status: 500 }),
});

serveWithSentry('firstcrack-mcp', handler);
