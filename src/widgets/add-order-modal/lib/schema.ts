import { z } from 'zod';

export type OrderLineDraft = { productId: string; quantity: string };

/** Manual order line qty: integer ≥ 1. Matches `order_lines.quantity` CHECK and create_order. */
export const orderLineQuantitySchema = z.coerce.number().int().min(1);

export function parseOrderLineQuantity(raw: string): number | null {
    const result = orderLineQuantitySchema.safeParse(raw);
    return result.success ? result.data : null;
}

/** Submit only when every line has qty ≥ 1 and at least one product is picked. */
export function canSubmitOrderLines(lines: OrderLineDraft[]): boolean {
    if (lines.some((l) => parseOrderLineQuantity(l.quantity) === null)) return false;
    return lines.some((l) => l.productId);
}
