/**
 * Cross-slice query key roots + keys that multiple layers invalidate.
 * Entity factories compose from these roots so partial invalidation stays consistent.
 * Do not put entity-private keys here — only roots/keys shared across FSD slices.
 */

export const dashboardKeys = {
    all: (userId: string) => ['dashboard', userId] as const,
};

/** Inventory / stock — used by bean-stock-event, inventory-alert, roast deduct, dashboard */
export const inventoryQueryRoots = {
    beanStockSummaries: ['bean-stock-summaries'] as const,
    beanStockSummary: ['bean-stock-summary'] as const,
    beanStockEvents: ['bean-stock-events'] as const,
    inventoryAlerts: ['inventory-alerts'] as const,
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

export const roastChartKeys = {
    history: (tsvPath: string | null) => ['history-chart', tsvPath] as const,
    /** tsv 없는 세션용 disabled placeholder — useQueries 내 키 충돌 방지 */
    historyNone: (fallbackKey: string) => ['history-chart', 'none', fallbackKey] as const,
};
