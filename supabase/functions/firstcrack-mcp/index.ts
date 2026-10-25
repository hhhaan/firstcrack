import { opaqueDependencies } from '../_shared/mcp-oauth/access.ts';
import { readGateway } from '../_shared/mcp-oauth/postgres.ts';
import { captureEdgeException, serveWithSentry } from '../_shared/sentry.ts';
import { readMcpConfig } from './auth.ts';
import { createMcpHandler } from './server.ts';

const databaseUrl = Deno.env.get('FIRSTCRACK_MCP_DATABASE_URL');
const config = databaseUrl ? readMcpConfig((key) => Deno.env.get(key)) : null;
const access =
    config && databaseUrl
        ? opaqueDependencies(config, readGateway(databaseUrl))
        : {
              verify: async () => null,
              userClient: () => ({
                  hasWorkspaceAccess: async () => ({ data: false, error: null }),
                  selectRows: async () => ({ data: [], error: null }),
              }),
          };
const handler = createMcpHandler({
    config,
    ...access,
    reportError: (error) => captureEdgeException(error, { function: 'firstcrack-mcp', status: 500 }),
});

serveWithSentry('firstcrack-mcp', handler);
