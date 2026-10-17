import type { BeanStockEventInsert } from '../api';

/** Strip insignificant trailing fractional zeros only (10000 stays 10000). */
export const formatCostPerKgForHash = (cost: number): string => {
    const s = String(cost);
    if (!s.includes('.')) return s;
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

/** Stable idempotency content key — must match server bean_event_request_hash. */
export const stockEventContentKey = (
    event: Pick<BeanStockEventInsert, 'user_id' | 'bean_id' | 'delta_grams' | 'event_type' | 'cost_per_kg'>,
): string => {
    const cost =
        event.cost_per_kg != null && Number.isFinite(event.cost_per_kg)
            ? formatCostPerKgForHash(event.cost_per_kg)
            : '';
    return `${event.user_id}|${event.bean_id}|${event.delta_grams}|${event.event_type}|${cost}`;
};
