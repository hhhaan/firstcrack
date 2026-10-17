/**
 * In-memory multi-ledger with the same partial-unique keys as production RPCs.
 * Used by integration tests that drive real event builders without a live DB.
 */

export type BeanEvent = {
    bean_id: string;
    delta_grams: number;
    event_type: string;
    reference_id?: string | null;
};

export type RoastedEvent = {
    bean_id?: string | null;
    blend_id?: string | null;
    delta_grams: number;
    event_type: string;
    reference_id?: string | null;
    is_estimate?: boolean;
};

export type ProductEvent = {
    product_id: string;
    delta_units: number;
    event_type: string;
    reference_id?: string | null;
};

export type InventoryLedger = {
    bean: BeanEvent[];
    roasted: RoastedEvent[];
    product: ProductEvent[];
};

export function emptyLedger(): InventoryLedger {
    return { bean: [], roasted: [], product: [] };
}

/** bean: unique (reference_id, bean_id) when reference_id set */
function beanKey(e: BeanEvent): string | null {
    if (!e.reference_id) return null;
    return `bean:${e.reference_id}:${e.bean_id}`;
}

/** roasted roast_inbound: unique (reference_id); packaging/blend: unique on conflict do nothing by ref+type+source */
function roastedKey(e: RoastedEvent): string | null {
    if (!e.reference_id) return null;
    if (e.event_type === 'roast_inbound') return `roasted:inbound:${e.reference_id}`;
    const source = e.blend_id ? `blend:${e.blend_id}` : `bean:${e.bean_id ?? ''}`;
    return `roasted:${e.event_type}:${e.reference_id}:${source}`;
}

/** product: unique (reference_id, product_id, event_type) */
function productKey(e: ProductEvent): string | null {
    if (!e.reference_id) return null;
    return `product:${e.reference_id}:${e.product_id}:${e.event_type}`;
}

function appendUnique<T>(rows: T[], row: T, key: string | null, seen: Set<string>): boolean {
    if (key == null) {
        rows.push(row);
        return true;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    rows.push(row);
    return true;
}

export function applyBeanEvents(ledger: InventoryLedger, events: BeanEvent[]): number {
    const seen = new Set(ledger.bean.map((e) => beanKey(e)).filter((k): k is string => k != null));
    let inserted = 0;
    for (const e of events) {
        if (appendUnique(ledger.bean, e, beanKey(e), seen)) inserted++;
    }
    return inserted;
}

export function applyRoastedEvents(ledger: InventoryLedger, events: RoastedEvent[]): number {
    const seen = new Set(ledger.roasted.map((e) => roastedKey(e)).filter((k): k is string => k != null));
    let inserted = 0;
    for (const e of events) {
        if (appendUnique(ledger.roasted, e, roastedKey(e), seen)) inserted++;
    }
    return inserted;
}

export function applyProductEvents(ledger: InventoryLedger, events: ProductEvent[]): number {
    const seen = new Set(ledger.product.map((e) => productKey(e)).filter((k): k is string => k != null));
    let inserted = 0;
    for (const e of events) {
        if (appendUnique(ledger.product, e, productKey(e), seen)) inserted++;
    }
    return inserted;
}

/** Packaging op = product + roasted in one "tx" (both apply or neither if we used all-or-nothing — here sequential like ON CONFLICT). */
export function applyPackagingOp(
    ledger: InventoryLedger,
    productEvents: ProductEvent[],
    roastedEvents: RoastedEvent[],
): { productInserted: number; roastedInserted: number } {
    return {
        productInserted: applyProductEvents(ledger, productEvents),
        roastedInserted: applyRoastedEvents(ledger, roastedEvents),
    };
}

export function sumBeanGrams(ledger: InventoryLedger, beanId: string): number {
    return ledger.bean.filter((e) => e.bean_id === beanId).reduce((s, e) => s + e.delta_grams, 0);
}

export function sumRoastedGrams(
    ledger: InventoryLedger,
    target: { beanId?: string | null; blendId?: string | null },
): number {
    return ledger.roasted
        .filter((e) => (target.blendId ? e.blend_id === target.blendId : e.bean_id === target.beanId && !e.blend_id))
        .reduce((s, e) => s + e.delta_grams, 0);
}

export function sumProductUnits(ledger: InventoryLedger, productId: string): number {
    return ledger.product.filter((e) => e.product_id === productId).reduce((s, e) => s + e.delta_units, 0);
}
