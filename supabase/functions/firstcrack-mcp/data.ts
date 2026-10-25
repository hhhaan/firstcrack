import { type Principal, UUID } from './auth.ts';

type QueryResult = { data: unknown; error: unknown };
export type ReadSelection = {
    table: string;
    columns: string;
    ownerColumn: string;
    ownerId: string;
    offset: number;
    limit: number;
};

/** Deliberately exposes no write builder or privileged client. */
export type ReadClient = {
    selectRows(selection: ReadSelection): Promise<QueryResult>;
    hasWorkspaceAccess(ownerId: string): Promise<QueryResult>;
};

export class ToolFailure extends Error {}
export class InvalidArguments extends Error {}
export class BackendFailure extends ToolFailure {
    constructor(
        message: string,
        readonly detail: unknown,
    ) {
        super(message);
    }
}

const pageProperties = {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
};
const workspaceProperties = {
    workspace_owner_id: {
        type: 'string',
        format: 'uuid',
        description: '연결 시 선택한 로스터리 소유자 ID. 생략해도 연결 범위는 유지됩니다.',
    },
    ...pageProperties,
};

const catalog = {
    get_my_profile: {
        description: '로그인한 본인의 이름과 사업장 정보를 조회합니다.',
        table: 'profiles',
        ownerColumn: 'id',
        columns: 'id,display_name,business_name,country_code',
        workspace: false,
    },
    list_my_workspaces: {
        description: '현재 연결에 동의한 로스터리를 조회합니다.',
        table: 'organizations',
        ownerColumn: 'owner_id',
        columns: 'id,owner_id,name',
        workspace: false,
    },
    list_green_beans: {
        description: '허용된 로스터리의 생두 목록과 원산지를 조회합니다. 실제 재고 잔량은 포함하지 않습니다.',
        table: 'beans',
        ownerColumn: 'user_id',
        columns: 'id,name,origin,region,variety,process,low_stock_threshold_grams',
        workspace: true,
    },
    list_products: {
        description: '허용된 로스터리의 상품과 포장 중량을 조회합니다.',
        table: 'products',
        ownerColumn: 'user_id',
        columns: 'id,name,sku,net_weight_grams,bean_id,blend_id,roast_profile_id,is_active',
        workspace: true,
    },
    list_orders: {
        description: '허용된 로스터리의 주문 상태와 상품별 수량을 조회합니다.',
        table: 'orders',
        ownerColumn: 'user_id',
        columns: 'id,platform,status,ordered_at,fulfilled_at,order_lines(id,product_id,title,quantity,status)',
        workspace: true,
    },
    list_production_plans: {
        description: '허용된 로스터리에 저장된 일별 생산 계획을 조회합니다. 반복 일정의 가상 회차는 포함하지 않습니다.',
        table: 'roast_day_plans',
        ownerColumn: 'user_id',
        columns:
            'id,date,roast_plan_batches(id,bean_name,batch_count,batch_size_kg,target_roasted_kg,status,scheduled_date)',
        workspace: true,
    },
    list_roast_sessions: {
        description: '허용된 로스터리의 로스팅 기록과 투입량·생산량을 조회합니다.',
        table: 'roast_sessions',
        ownerColumn: 'user_id',
        columns: 'id,batch_name,bean_label,status,roasted_at,weight_grams,output_weight_grams,duration_seconds',
        workspace: true,
    },
} as const;

export const tools = Object.entries(catalog).map(([name, spec]) => ({
    name,
    description: spec.description,
    inputSchema: {
        type: 'object',
        properties: spec.workspace ? workspaceProperties : pageProperties,
        additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: [{ type: 'oauth2', scopes: ['firstcrack:read'] }],
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['firstcrack:read'] }] },
}));

function parseArguments(value: unknown, workspace: boolean) {
    const args = value ?? {};
    if (typeof args !== 'object' || Array.isArray(args)) throw new InvalidArguments('Invalid tool arguments');
    const row = args as Record<string, unknown>;
    const allowed = workspace ? workspaceProperties : pageProperties;
    if (Object.keys(row).some((key) => !Object.hasOwn(allowed, key))) {
        throw new InvalidArguments('Unknown tool argument');
    }
    const limit = row.limit ?? 50;
    const offset = row.offset ?? 0;
    const owner = row.workspace_owner_id;
    if (
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        typeof offset !== 'number' ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 10000 ||
        (owner !== undefined && (typeof owner !== 'string' || !UUID.test(owner)))
    ) {
        throw new InvalidArguments('Invalid tool arguments');
    }
    return { limit, offset, owner: owner as string | undefined };
}

export async function readTool(client: ReadClient, principal: Principal, name: string, input: unknown) {
    if (!Object.hasOwn(catalog, name)) throw new InvalidArguments('Unknown read-only tool');
    const spec = catalog[name as keyof typeof catalog];
    const { limit, offset, owner } = parseArguments(input, spec.workspace);
    const ownerId = principal.workspaceOwnerId;
    if (owner && owner !== ownerId) throw new ToolFailure('이 연결에서 허용되지 않은 로스터리입니다.');
    // Re-check current membership on every call, including after a member is removed.
    const access = await client.hasWorkspaceAccess(ownerId);
    if (access.error) throw new BackendFailure('로스터리 권한을 확인할 수 없습니다.', access.error);
    if (access.data !== true) throw new ToolFailure('이 로스터리를 조회할 권한이 없습니다.');

    const { data, error } = await client.selectRows({
        table: spec.table,
        columns: spec.columns,
        ownerColumn: spec.ownerColumn,
        ownerId: name === 'get_my_profile' ? principal.userId : ownerId,
        offset,
        limit,
    });
    if (error) throw new BackendFailure('정보를 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.', error);
    if (!Array.isArray(data))
        throw new BackendFailure('정보 조회 응답을 확인할 수 없습니다.', new Error('Invalid read result shape'));
    return {
        mode: 'live',
        items: data.slice(0, limit),
        next_offset: data.length > limit ? offset + limit : null,
    };
}
