/** Platform statuses that still need local fulfill (stock) before dispatch. */
const FULFILLABLE_STATUSES = new Set(['paid', 'preparing', 'shipped', 'delivered', 'confirmed']);

export type OrderActionOrder = {
    status: string;
    fulfilled_at: string | null;
    platform: string;
    connection_id: string | null;
};

export type OrderActionDispatch = { status: string } | null | undefined;

export const orderActionFlags = (order: OrderActionOrder, dispatch?: OrderActionDispatch) => {
    const cancelled = order.status === 'cancelled' || order.status === 'refunded';
    const fulfilled = !!order.fulfilled_at && !cancelled;
    const canFulfill = !fulfilled && !cancelled && FULFILLABLE_STATUSES.has(order.status);
    const canDispatch =
        order.platform !== 'manual' &&
        order.platform !== 'toss_place' &&
        fulfilled &&
        !!order.connection_id &&
        (!dispatch || dispatch.status === 'failed');
    return { cancelled, fulfilled, canFulfill, canDispatch };
};
