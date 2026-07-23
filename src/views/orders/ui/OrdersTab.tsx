import { type OrderWithLines, useOrders } from '@entities/order';
import { type OrderDispatch, useOrderDispatches } from '@entities/order-dispatch';
import { useActiveWorkspace } from '@entities/organization';
import { useCancelOrder } from '@features/cancel-order';
import { DispatchModal } from '@features/dispatch-order';
import { useFulfillOrder } from '@features/fulfill-order';
import { formatDateShort } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { AddOrderModal } from '@widgets/add-order-modal';
import { RoastingRequirementsCard } from '@widgets/roasting-requirements-card';
import { Plus, ShoppingBag, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OrdersTableSkeleton } from './OrdersSkeleton';
import {
    DISPATCH_STATUS_EN,
    dispatchTone,
    EmptyState,
    GhostButton,
    ORDER_STATUS_EN,
    orderStatusTone,
    PLATFORM_EN,
} from './orderUi';

export function OrdersTab() {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: orders = [], isLoading } = useOrders(userId);
    const { data: dispatches = [] } = useOrderDispatches(userId);
    const fulfill = useFulfillOrder();
    const cancel = useCancelOrder();
    const [showAdd, setShowAdd] = useState(false);
    const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);

    const dispatchByOrder = useMemo(() => {
        const m = new Map<string, OrderDispatch>();
        for (const d of dispatches) m.set(d.order_id, d);
        return m;
    }, [dispatches]);

    return (
        <div className="space-y-5">
            <RoastingRequirementsCard />

            {isLoading ? (
                <OrdersTableSkeleton />
            ) : orders.length === 0 ? (
                <EmptyState
                    icon={<ShoppingBag size={20} strokeWidth={1.5} />}
                    message={t('orders.order.empty')}
                    action={
                        <SurfaceButton
                            onClick={() => setShowAdd(true)}
                            icon={<Plus size={14} strokeWidth={2} />}
                            className="px-4 py-2"
                        >
                            {t('orders.order.newTitle')}
                        </SurfaceButton>
                    }
                />
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                {['date', 'platform', 'buyer', 'items', 'status', 'action'].map((c) => (
                                    <th
                                        key={c}
                                        className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted"
                                    >
                                        {c === 'action' ? '' : t(`orders.order.col.${c}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((o) => (
                                <OrderRow
                                    key={o.id}
                                    order={o}
                                    dispatch={dispatchByOrder.get(o.id)}
                                    onFulfill={() => fulfill.mutate(o.id)}
                                    onCancel={() => {
                                        if (window.confirm(t('orders.order.cancelConfirm'))) {
                                            cancel.mutate(o.id);
                                        }
                                    }}
                                    onDispatch={() => setDispatchOrderId(o.id)}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <AddOrderModal open={showAdd} onClose={() => setShowAdd(false)} />
            <DispatchModal
                open={!!dispatchOrderId}
                orderId={dispatchOrderId}
                onClose={() => setDispatchOrderId(null)}
            />
        </div>
    );
}

function OrderRow({
    order,
    dispatch,
    onFulfill,
    onCancel,
    onDispatch,
}: {
    order: OrderWithLines;
    dispatch?: OrderDispatch;
    onFulfill: () => void;
    onCancel: () => void;
    onDispatch: () => void;
}) {
    const { t } = useTranslation();
    const [nowMs] = useState(() => Date.now());
    const itemCount = order.order_lines.filter((l) => l.status === 'active').reduce((n, l) => n + l.quantity, 0);
    const cancelled = order.status === 'cancelled' || order.status === 'refunded';
    const fulfilled = !!order.fulfilled_at && !cancelled;
    const canFulfill = !fulfilled && !cancelled && (order.status === 'paid' || order.status === 'preparing');
    // Local cancel restores product stock; channel platforms sync cancel via webhook — avoid double-restoring.
    const canCancel = order.platform === 'manual' && !cancelled;
    const canDispatch =
        order.platform !== 'manual' &&
        fulfilled &&
        !!order.connection_id &&
        (!dispatch || dispatch.status === 'failed');
    const sentDelayed =
        dispatch?.status === 'sent' &&
        !!dispatch.sent_at &&
        nowMs - new Date(dispatch.sent_at).getTime() > 30 * 60 * 1000;
    const statusLabel = cancelled
        ? (ORDER_STATUS_EN[order.status] ?? order.status)
        : fulfilled
          ? 'Fulfilled'
          : (ORDER_STATUS_EN[order.status] ?? order.status);

    return (
        <tr className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61] dark:hover:bg-surface-elevated/40">
            <td className="px-4 py-3.5 font-mono text-[13px] text-secondary">{formatDateShort(order.ordered_at)}</td>
            <td className="px-4 py-3.5">
                <Badge tone="soft" size="sm">
                    {PLATFORM_EN[order.platform] ?? order.platform}
                </Badge>
            </td>
            <td className="px-4 py-3.5 text-[13px] text-primary tracking-[0.14px]">{order.buyer_name ?? '—'}</td>
            <td className="px-4 py-3.5 font-mono text-[13px] text-secondary">{itemCount}</td>
            <td className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={orderStatusTone(order.status, fulfilled)} size="sm">
                        {statusLabel}
                    </Badge>
                    {dispatch ? (
                        <Badge tone={dispatchTone(dispatch.status, sentDelayed)} size="sm">
                            {sentDelayed
                                ? 'Platform confirm delayed'
                                : (DISPATCH_STATUS_EN[dispatch.status] ?? dispatch.status)}
                        </Badge>
                    ) : null}
                </div>
                {dispatch?.status === 'failed' && dispatch.last_error ? (
                    <p className="mt-1 max-w-[220px] truncate text-[11px] text-red-600 dark:text-red-400">
                        {dispatch.last_error}
                    </p>
                ) : null}
            </td>
            <td className="px-4 py-3.5">
                <div className="flex flex-wrap gap-1.5">
                    {canFulfill ? (
                        <GhostButton
                            onClick={onFulfill}
                            className="text-primary border-primary/15 hover:bg-primary hover:text-white dark:hover:bg-black dark:hover:text-white dark:hover:border-white"
                        >
                            {t('orders.order.fulfill')}
                        </GhostButton>
                    ) : null}
                    {canCancel ? <GhostButton onClick={onCancel}>{t('orders.order.cancel')}</GhostButton> : null}
                    {canDispatch ? (
                        <GhostButton onClick={onDispatch}>
                            <Truck size={13} strokeWidth={1.75} />
                            {dispatch?.status === 'failed' ? t('orders.dispatch.retry') : t('orders.dispatch.cta')}
                        </GhostButton>
                    ) : null}
                </div>
            </td>
        </tr>
    );
}
