import { z } from 'zod';
import { type Principal, READ_SCOPE, UUID, WRITE_SCOPE } from './auth.ts';
import { BackendFailure, InvalidArguments, ToolFailure } from './data.ts';

const id = z.string().regex(UUID);
const positiveWeight = z.number().int().positive().max(1e9);
const deltaWeight = z
    .number()
    .int()
    .min(-1e9)
    .max(1e9)
    .refine((value) => value !== 0);
const common = { request_id: id, reason: z.string().trim().min(1).max(500) };
const schemas = {
    receive_green_stock: z
        .object({
            ...common,
            bean_id: id,
            quantity_g: positiveWeight,
            unit_cost_per_kg: z.number().finite().min(0).max(1e9).optional(),
        })
        .strict(),
    adjust_green_stock: z.object({ ...common, bean_id: id, delta_g: deltaWeight }).strict(),
    adjust_roasted_stock: z.object({ ...common, bean_id: id, delta_g: deltaWeight }).strict(),
    adjust_product_stock: z
        .object({ ...common, product_id: id, delta: deltaWeight.refine(Number.isSafeInteger) })
        .strict(),
    record_roast_production: z
        .object({
            ...common,
            production_id: id,
            bean_id: id,
            input_weight_g: positiveWeight,
            output_weight_g: positiveWeight,
            roasted_at: z.string().datetime({ offset: true }),
        })
        .strict()
        .refine((value) => value.output_weight_g <= value.input_weight_g),
    record_packaging_production: z
        .object({
            ...common,
            production_id: id,
            product_id: id,
            quantity: positiveWeight.refine(Number.isSafeInteger),
            packaged_at: z.string().datetime({ offset: true }),
        })
        .strict(),
};

const uuidProperty = { type: 'string', format: 'uuid' };
const weightProperty = { type: 'integer', exclusiveMinimum: 0, maximum: 1e9 };
const deltaProperty = { type: 'integer', minimum: -1e9, maximum: 1e9, not: { const: 0 } };
const commonProperties = {
    request_id: {
        ...uuidProperty,
        description: '재시도 시 같은 ID와 인자를 유지합니다. 성공 여부가 불명확해도 새 ID로 재시도하지 마세요.',
    },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '감사 기록에 남길 입고·조정·생산 사유.' },
};
const productionProperty = {
    ...uuidProperty,
    description:
        '앱과 공유하는 실제 생산 기록 ID. 동일 생산에는 같은 ID를 사용합니다. 다른 ID로 입력된 동일 실물은 자동 판별할 수 없습니다.',
};
const catalog = {
    receive_green_stock: {
        description:
            '선택한 로스터리에 생두를 입고합니다. 수량 단위는 g, 선택적 단가는 kg당 금액입니다. 품목 자체를 새로 만들지는 않습니다.',
        properties: {
            bean_id: uuidProperty,
            quantity_g: weightProperty,
            unit_cost_per_kg: { type: 'number', minimum: 0, maximum: 1e9 },
        },
        required: ['bean_id', 'quantity_g'],
    },
    adjust_green_stock: {
        description:
            '생두 재고를 delta_g만큼 증감합니다. 목표 잔량이 아닌 증감량(g)을 입력합니다. 음수 재고는 거절됩니다.',
        properties: { bean_id: uuidProperty, delta_g: deltaProperty },
        required: ['bean_id', 'delta_g'],
    },
    adjust_roasted_stock: {
        description: '단일 생두의 벌크 원두 재고를 delta_g만큼 증감합니다. 증감량 단위는 g이며 음수 재고는 거절됩니다.',
        properties: { bean_id: uuidProperty, delta_g: deltaProperty },
        required: ['bean_id', 'delta_g'],
    },
    adjust_product_stock: {
        description: '완제품 재고를 delta개만큼 증감합니다. 정수 증감량을 입력하며 음수 재고는 거절됩니다.',
        properties: { product_id: uuidProperty, delta: { ...deltaProperty, type: 'integer' } },
        required: ['product_id', 'delta'],
    },
    record_roast_production: {
        description:
            '단일 생두 로스팅 생산 기록을 저장하고 생두 차감과 벌크 원두 입고를 함께 반영합니다. 장비를 제어하지 않습니다.',
        properties: {
            production_id: productionProperty,
            bean_id: uuidProperty,
            input_weight_g: weightProperty,
            output_weight_g: weightProperty,
            roasted_at: { type: 'string', format: 'date-time' },
        },
        required: ['production_id', 'bean_id', 'input_weight_g', 'output_weight_g', 'roasted_at'],
    },
    record_packaging_production: {
        description:
            '포장 생산을 기록하고 제품 규격에 따른 벌크 원두 차감과 완제품 입고를 함께 반영합니다. 수량은 완제품 정수 개수입니다.',
        properties: {
            production_id: productionProperty,
            product_id: uuidProperty,
            quantity: { ...weightProperty, type: 'integer' },
            packaged_at: { type: 'string', format: 'date-time' },
        },
        required: ['production_id', 'product_id', 'quantity', 'packaged_at'],
    },
};

type WriteName = keyof typeof schemas;
export const isWriteTool = (name: string): name is WriteName => Object.hasOwn(schemas, name);
export const writeTools = Object.entries(catalog).map(([name, spec]) => ({
    name,
    description: spec.description,
    inputSchema: {
        type: 'object',
        properties: { ...commonProperties, ...spec.properties },
        required: ['request_id', 'reason', ...spec.required],
        additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    securitySchemes: [{ type: 'oauth2', scopes: [READ_SCOPE, WRITE_SCOPE] }],
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: [READ_SCOPE, WRITE_SCOPE] }] },
}));

export type WriteClient = {
    executeWrite(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
};

const errors: Record<string, string> = {
    invalid_token: '연결이 만료되었거나 철회되었습니다. 다시 연결해 주세요.',
    insufficient_scope: '새 재고·생산 쓰기 동의가 필요합니다.',
    access_denied: '이 로스터리 또는 참조 품목을 변경할 권한이 없습니다.',
    invalid_arguments: '수량, 단위 또는 참조 ID를 확인해 주세요.',
    insufficient_stock: '재고가 부족하여 변경 전체가 취소되었습니다.',
    inventory_busy: '다른 재고 작업이 진행 중입니다. 같은 요청 ID와 인자로 다시 시도해 주세요.',
    idempotency_conflict: '이미 사용한 요청 ID의 인자를 변경할 수 없습니다.',
    production_exists: '이미 기록된 생산 ID입니다. 같은 생산을 새 요청 ID로 등록하지 마세요.',
    insufficient_plan: '현재 요금제에서는 재고·생산 쓰기를 사용할 수 없습니다.',
};

export async function writeTool(client: WriteClient, principal: Principal, name: WriteName, input: unknown) {
    if (!principal.canWrite) throw new ToolFailure(errors.insufficient_scope);
    const parsed = schemas[name].safeParse(input);
    if (!parsed.success) throw new InvalidArguments('Invalid inventory or production arguments');
    const output = await client.executeWrite(name, parsed.data);
    if (typeof output.error === 'string') {
        if (Object.hasOwn(errors, output.error)) throw new ToolFailure(errors[output.error]);
        throw new BackendFailure('재고 변경을 완료할 수 없습니다.', new Error('Unexpected MCP write failure'));
    }
    if (!output.result || typeof output.result !== 'object' || Array.isArray(output.result))
        throw new BackendFailure('재고 변경 응답을 확인할 수 없습니다.', new Error('Invalid write result shape'));
    return output.result;
}
