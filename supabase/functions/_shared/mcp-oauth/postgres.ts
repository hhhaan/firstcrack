import postgres from 'npm:postgres@3.4.9';
import type { JsonRecord, Store } from './service.ts';

function connection(url: string, role: 'firstcrack_mcp_issuer' | 'firstcrack_mcp_gateway') {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Invalid MCP database configuration');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Invalid MCP database configuration');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    const sql = postgres(url, {
        max: 2,
        prepare: false,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: local ? false : { rejectUnauthorized: true },
        onnotice: () => {},
    });
    let checked: Promise<void> | undefined;
    const ready = () =>
        (checked ??= (async () => {
            const [r] = await sql`select r.rolsuper, r.rolbypassrls,
            pg_has_role(current_user, ${role}, 'USAGE') as allowed,
            pg_has_role(current_user, 'firstcrack_mcp_store', 'MEMBER') as store_owner,
            pg_has_role(current_user, 'firstcrack_mcp_data', 'MEMBER') as data_owner,
            pg_has_role(current_user, ${role === 'firstcrack_mcp_issuer' ? 'firstcrack_mcp_gateway' : 'firstcrack_mcp_issuer'}, 'MEMBER') as other_runtime,
            pg_has_role(current_user, 'service_role', 'MEMBER') as service_role,
            pg_has_role(current_user, 'authenticated', 'MEMBER') as native_role
            from pg_roles r where r.rolname = current_user`;
            if (
                !r?.allowed ||
                r.rolsuper ||
                r.rolbypassrls ||
                r.store_owner ||
                r.data_owner ||
                r.other_runtime ||
                r.service_role ||
                r.native_role
            )
                throw new Error('MCP database role is not restricted');
        })());
    return { sql, ready, close: () => sql.end({ timeout: 1 }) };
}

/** Runtime credentials must belong to the dedicated function-only roles, never service_role. */
export function issuerStore(url: string): Store & { close(): Promise<void> } {
    const { sql, ready, close } = connection(url, 'firstcrack_mcp_issuer');
    return {
        close,
        call: async (action, args) => {
            await ready();
            const [row] =
                await sql`select private.mcp_oauth(${action}, ${sql.json(args as postgres.JSONValue)}::jsonb) as result`;
            if (!row?.result || typeof row.result !== 'object') throw new Error('Invalid OAuth storage response');
            return row.result as JsonRecord;
        },
    };
}

export function readGateway(url: string) {
    const { sql, ready, close } = connection(url, 'firstcrack_mcp_gateway');
    return {
        close,
        access: async (hash: string, issuer: string, resource: string): Promise<JsonRecord | null> => {
            await ready();
            const [row] = await sql`select private.mcp_access(${hash}, ${issuer}, ${resource}) as result`;
            return row?.result ?? null;
        },
        read: async (
            hash: string,
            issuer: string,
            resource: string,
            tool: string,
            args: JsonRecord,
        ): Promise<JsonRecord> => {
            await ready();
            const [row] =
                await sql`select private.mcp_read(${hash}, ${issuer}, ${resource}, ${tool}, ${sql.json(args as postgres.JSONValue)}::jsonb) as result`;
            return row?.result ?? { error: 'invalid_token' };
        },
    };
}
