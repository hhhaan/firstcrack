import { z } from 'zod';

export type OrderLineDraft = { productId: string; quantity: string };

/** Manual order line qty: integer ≥ 1. Matches `order_lines.quantity` CHECK and create_order. */
export const orderLineQuantitySchema = z.coerce.number().int().min(1);

export function parseOrderLineQuantity(raw: string): number | null {
    const result = orderLineQuantitySchema.safeParse(raw);
    return result.success ? result.data : null;
}

/** Submit only when at least one product is picked and every picked line has qty ≥ 1. */
export function canSubmitOrderLines(lines: OrderLineDraft[]): boolean {
    const selected = lines.filter((l) => l.productId);
    if (selected.length === 0) return false;
    return selected.every((l) => parseOrderLineQuantity(l.quantity) !== null);
}
