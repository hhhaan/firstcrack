/**
 * Cross-slice query key roots + keys that multiple layers invalidate.
 * Entity factories compose from these roots so partial invalidation stays consistent.
 * Do not put entity-private keys here — only roots/keys shared across FSD slices.
 */

export const dashboardKeys = {
    all: (userId: string) => ['dashboard', userId] as const,
    /** Selected-month KPI. Prefixed by `all` so dashboard invalidation refetches it. */
    month: (userId: string, ym: string) => ['dashboard', userId, 'month', ym] as const,
};

/** Profile row — gates (`useEffectivePlan`) + entity `useProfile` share this cache. */
export const profileKeys = {
    detail: (userId: string) => ['profile', userId] as const,
};

/** Roast profile roots — roast mutations re-derive stats cut from saved records. */
export const roastProfileQueryRoots = {
    profiles: ['roast_profiles'] as const,
    consistency: ['profile-consistency'] as const,
    beanHistory: ['profile-bean-history'] as const,
};

/** Green bean list — the roast-session join (`beans`) is re-derived from this cache on edit. */
export const beanQueryRoots = {
    all: ['beans'] as const,
};

/** Blend list — shared with the roast-session join on saved-source edits. */
export const blendQueryRoots = {
    all: ['blends'] as const,
};

/** Per-session “stock already booked” probe across both ledgers (History relink guard). */
export const roastSessionStockKeys = {
    bySession: (sessionId: string) => ['roast-session-stock', sessionId] as const,
};

/** Inventory / stock — used by bean-stock-event, inventory-alert, roast deduct, packaging, dashboard */
export const inventoryQueryRoots = {
    beanStockSummaries: ['bean-stock-summaries'] as const,
    beanStockSummary: ['bean-stock-summary'] as const,
    beanStockEvents: ['bean-stock-events'] as const,
    beanPurchaseCosts: ['bean-purchase-costs'] as const,
    inventoryAlerts: ['inventory-alerts'] as const,
    roastedStock: ['roasted-stock'] as const,
    productStock: ['product-stock'] as const,
};

/**
 * User roasted stock + event log. Events nest under `byUser` so invalidate(byUser)
 * also drops the ledger (sibling `['roasted-stock','events',userId]` never matched).
 */
export const roastedStockKeys = {
    root: inventoryQueryRoots.roastedStock,
    byUser: (userId: string) => [...inventoryQueryRoots.roastedStock, userId] as const,
    events: (userId: string) => [...inventoryQueryRoots.roastedStock, userId, 'events'] as const,
};

/** Product stock + per-product events nested under `byUser`. */
export const productStockKeys = {
    root: inventoryQueryRoots.productStock,
    byUser: (userId: string) => [...inventoryQueryRoots.productStock, userId] as const,
    events: (userId: string, productId: string) =>
        [...inventoryQueryRoots.productStock, userId, 'events', productId] as const,
};

/** Plan / schedule — used only via planKeys factories + invalidateScheduledBatchQueries */
export const planQueryRoots = {
    day: ['day_plan'] as const,
    batches: ['plan_batches'] as const,
    dayBatches: ['day_batches'] as const,
    rangeBatches: ['range_batches'] as const,
    rangeSummary: ['day_plan_range'] as const,
    recurrenceRules: ['recurrence_rules'] as const,
    weekSummary: ['week_summary'] as const,
    monthSummary: ['month_summary'] as const,
};

export const weatherKeys = {
    coords: ['weather', 'coords'] as const,
    current: (lat?: number, lng?: number) => ['weather', 'current', lat, lng] as const,
};

export const coffeeFuturesKeys = {
    all: ['coffee-futures'] as const,
};

/** Orders — used by order, order-dispatch, sales-channel, fulfill, finished-goods */
export const orderKeys = {
    all: (userId: string) => ['orders', userId] as const,
    /** Nested under `all` so every existing invalidate(all) also drops the paged caches. */
    paginated: (userId: string, params: Record<string, unknown>) => ['orders', userId, 'paginated', params] as const,
    requirements: (userId: string) => ['roasting-requirements', userId] as const,
};
