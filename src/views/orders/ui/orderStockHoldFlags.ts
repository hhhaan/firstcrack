/** Mirrors OrdersTab retry visibility without mounting the table. */
export const canRetryHold = (input: { hold: boolean; fulfilled: boolean; cancelled: boolean; status: string }) =>
    input.hold && !input.fulfilled && !input.cancelled && (input.status === 'shipped' || input.status === 'delivered');

export const stockHoldBadgeKey = (reason?: string | null) =>
    reason === 'no_stock_demand' ? 'orders.order.stockHoldNoDemandBadge' : 'orders.order.stockHoldBadge';
