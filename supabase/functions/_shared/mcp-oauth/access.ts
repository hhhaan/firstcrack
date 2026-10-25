import type { McpConfig } from '../../firstcrack-mcp/auth.ts';
import { ToolFailure } from '../../firstcrack-mcp/data.ts';
import { digest, isOpaque } from './crypto.ts';
import type { JsonRecord } from './service.ts';

export type Gateway = {
    access(hash: string, issuer: string, resource: string): Promise<JsonRecord | null>;
    read(hash: string, issuer: string, resource: string, tool: string, args: JsonRecord): Promise<JsonRecord>;
};
export function opaqueDependencies(config: McpConfig, gateway: Gateway) {
    const hashFor = async (req: Request) => {
        const token = /^Bearer (\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
        return isOpaque(token, 'at') ? digest(token) : null;
    };
    return {
        verify: async (_req: Request, token: string) =>
            isOpaque(token, 'at') ? gateway.access(await digest(token), config.issuer, config.resource) : null,
        userClient: (req: Request) => ({
            hasWorkspaceAccess: async (ownerId: string) => {
                const hash = await hashFor(req);
                const proof = hash ? await gateway.access(hash, config.issuer, config.resource) : null;
                return { data: !!proof && proof.firstcrack_workspace_owner_id === ownerId, error: null };
            },
            selectRows: async (selection: { tool: string; limit: number; offset: number }) => {
                const hash = await hashFor(req);
                if (!hash) throw new ToolFailure('로그인이 필요합니다.');
                const result = await gateway.read(hash, config.issuer, config.resource, selection.tool, {
                    limit: selection.limit,
                    offset: selection.offset,
                });
                if (result.error === 'insufficient_plan')
                    throw new ToolFailure('Pro 이상 요금제에서 연결할 수 있습니다.');
                if (result.error) throw new ToolFailure('연결 권한이 만료되었거나 철회되었습니다. 다시 연결해 주세요.');
                return { data: result.rows, error: null };
            },
        }),
    };
}
