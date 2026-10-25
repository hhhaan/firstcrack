import { readIssuerConfig } from '../_shared/mcp-oauth/config.ts';
import { createIssuerHandler } from '../_shared/mcp-oauth/http.ts';
import { resolveNativeIdentity } from '../_shared/mcp-oauth/identity.ts';
import { issuerStore } from '../_shared/mcp-oauth/postgres.ts';
import { IssuerService } from '../_shared/mcp-oauth/service.ts';
import { serveWithSentry } from '../_shared/sentry.ts';

const config = readIssuerConfig((name) => Deno.env.get(name));
const service = config
    ? new IssuerService(config, issuerStore(Deno.env.get('FIRSTCRACK_OAUTH_DATABASE_URL') ?? ''))
    : null;
serveWithSentry('firstcrack-oauth', createIssuerHandler({ service, identity: resolveNativeIdentity }));
