import {
    type FulfillmentHoldShortage,
    type OrderFulfillmentHold,
    type OrderLine,
    type OrderStatusFilter,
    type OrderWithLines,
    useOpenFulfillmentHolds,
    useOrdersPaginated,
} from '@entities/order';
import { type OrderDispatch, useOrderDispatches } from '@entities/order-dispatch';
import { useActiveWorkspace } from '@entities/organization';
import { useProducts } from '@entities/product';
import { DispatchModal } from '@features/dispatch-order';
import { LinkOrderLineModal } from '@features/map-channel-product';
import { orderActionFlags, useCancelOrder, useFulfillOrder, useRetryOrderFulfillment } from '@features/order-status';
import { formatDateShort } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { FilterDropdown } from '@shared/ui/FilterDropdown';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { TablePagination } from '@shared/ui/TablePagination';
import { confirm } from '@tauri-apps/plugin-dialog';
import { AddOrderModal } from '@widgets/add-order-modal';
import { DateRangeFilter } from '@widgets/date-range-filter';
import { RoastingRequirementsCard } from '@widgets/roasting-requirements-card';
import { format, subMonths } from 'date-fns';
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Search, ShoppingBag, Truck } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrderFilters } from '../hooks/useOrderFilters';
import { OrdersTableSkeleton } from './OrdersSkeleton';
import { canRetryHold, stockHoldBadgeKey } from './orderStockHoldFlags';
import { dispatchTone, EmptyState, GhostButton, orderStatusTone } from './orderUi';

const PAGE_SIZE = 20;
const CUSTOM_RANGE_MONTHS = 24;
const STATUS_OPTIONS: OrderStatusFilter[] = ['unfulfilled', 'fulfilled', 'cancelled'];
const PLATFORM_OPTIONS = ['manual', 'naver', 'cafe24', 'shopify'];

export function OrdersTab() {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const f = useOrderFilters();
    const { data: page, isLoading } = useOrdersPaginated({
        userId,
        page: f.page,
        pageSize: PAGE_SIZE,
        status: f.status,
        platform: f.platform === 'all' ? null : f.platform,
        search: f.search,
        fromYM: f.fromYM || null,
        toYM: f.toYM || null,
    });
    const orders = page?.data ?? [];
    const total = page?.total ?? 0;
    const { data: dispatches = [] } = useOrderDispatches(userId);
    const fulfill = useFulfillOrder();
    const retryFulfillment = useRetryOrderFulfillment();
    const cancel = useCancelOrder();
    const { data: fulfillmentHolds = [] } = useOpenFulfillmentHolds(userId);
    const { data: products = [] } = useProducts(userId);
    const [showAdd, setShowAdd] = useState(false);
    const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);
    const [linkLine, setLinkLine] = useState<{ line: OrderLine; platform: string } | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const dispatchByOrder = useMemo(() => {
        const m = new Map<string, OrderDispatch>();
        for (const d of dispatches) m.set(d.order_id, d);
        return m;
    }, [dispatches]);

    const holdByOrder = useMemo(() => {
        const m = new Map<string, OrderFulfillmentHold>();
        for (const h of fulfillmentHolds) m.set(h.order_id, h);
        return m;
    }, [fulfillmentHolds]);

    const productNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of products) m.set(p.id, p.name);
        return m;
    }, [products]);

    // ponytail: fixed 24-month window instead of deriving from data — the page only holds 20 orders,
    // so the real span isn't available without another query. Widen or query the oldest order if a
    // roastery needs to filter further back.
    const monthOptions = useMemo(() => {
        const now = new Date();
        return Array.from({ length: CUSTOM_RANGE_MONTHS }, (_, i) =>
            format(subMonths(now, CUSTOM_RANGE_MONTHS - 1 - i), 'yyyy-MM'),
        );
    }, []);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(f.page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE + 1;
    const end = Math.min(safePage * PAGE_SIZE, total);
    // A filtered-to-zero result is not an empty workspace — the onboarding empty state would be a lie.
    const isEmptyWorkspace = total === 0 && !f.isFiltered;

    return (
        <div className="space-y-5">
            <RoastingRequirementsCard />

            <div className="flex flex-col gap-3 rounded-lg bg-main-bg p-4 lg:flex-row lg:items-center dark:border dark:border-[#585d61]">
                <div className="flex flex-1 items-center gap-2 rounded-lg bg-surface px-3 py-2 dark:bg-surface-elevated">
                    <Search size={14} strokeWidth={2} className="shrink-0 text-muted" />
                    <input
                        className="w-full border-none bg-transparent font-body text-[13px] tracking-[0.14px] text-primary outline-none placeholder:text-muted"
                        value={f.search}
                        onChange={(e) => f.setSearch(e.target.value)}
                        placeholder={t('orders.order.searchPlaceholder')}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <FilterDropdown
                        label={t('orders.order.allStatuses')}
                        value={f.status}
                        options={STATUS_OPTIONS}
                        onSelect={(v) => f.setStatus(v as OrderStatusFilter)}
                        optionLabel={(v) => t(`orders.order.filter.${v}`, { defaultValue: v })}
                    />
                    <FilterDropdown
                        label={t('orders.order.allPlatforms')}
                        value={f.platform}
                        options={PLATFORM_OPTIONS}
                        onSelect={f.setPlatform}
                        optionLabel={(v) => t(`orders.channel.platform.${v}`, { defaultValue: v })}
                    />
                    <DateRangeFilter
                        preset={f.datePreset}
                        fromYM={f.fromYM}
                        toYM={f.toYM}
                        monthOptions={monthOptions}
                        onPresetChange={f.setDatePreset}
                        onFromYM={f.setFromYM}
                        onToYM={f.setToYM}
                    />
                    <SurfaceButton
                        onClick={() => setShowAdd(true)}
                        icon={<Plus size={14} strokeWidth={2} />}
                        className="px-4 py-2"
                    >
                        {t('orders.order.newTitle')}
                    </SurfaceButton>
                </div>
            </div>

            {isLoading ? (
                <OrdersTableSkeleton />
            ) : isEmptyWorkspace ? (
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
            ) : total === 0 ? (
                <EmptyState
                    icon={<Search size={20} strokeWidth={1.5} />}
                    message={t('orders.order.noMatch')}
                    action={<GhostButton onClick={f.reset}>{t('orders.order.clearFilters')}</GhostButton>}
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
                                    hold={holdByOrder.get(o.id)}
                                    productNameById={productNameById}
                                    expanded={expandedId === o.id}
                                    onToggle={() => setExpandedId((id) => (id === o.id ? null : o.id))}
                                    fulfillPending={fulfill.isPending}
                                    retryPending={retryFulfillment.isPending}
                                    onFulfill={() => fulfill.mutate(o.id)}
                                    onRetryFulfillment={() => retryFulfillment.mutate(o.id)}
                                    onCancel={async () => {
                                        if (await confirm(t('orders.order.cancelConfirm'))) {
                                            cancel.mutate(o.id);
                                        }
                                    }}
                                    onDispatch={() => setDispatchOrderId(o.id)}
                                    onLinkLine={(line) => setLinkLine({ line, platform: o.platform })}
                                />
                            ))}
                        </tbody>
                    </table>

                    <div className="flex flex-col gap-3 border-t border-border-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-[#585d61]">
                        <span className="text-xs tracking-[0.14px] text-muted">
                            {t('orders.order.pagination', { start, end, total })}
                        </span>
                        <TablePagination page={safePage} totalPages={totalPages} onPageChange={f.setPage} />
                    </div>
                </div>
            )}

            <AddOrderModal open={showAdd} onClose={() => setShowAdd(false)} />
            <DispatchModal
                open={!!dispatchOrderId}
                orderId={dispatchOrderId}
                onClose={() => setDispatchOrderId(null)}
            />
            <LinkOrderLineModal
                line={linkLine?.line ?? null}
                platform={linkLine?.platform ?? 'manual'}
                onClose={() => setLinkLine(null)}
            />
        </div>
    );
}

function OrderRow({
    order,
    dispatch,
    hold,
    productNameById,
    expanded,
    onToggle,
    fulfillPending,
    retryPending,
    onFulfill,
    onRetryFulfillment,
    onCancel,
    onDispatch,
    onLinkLine,
}: {
    order: OrderWithLines;
    dispatch?: OrderDispatch;
    hold?: OrderFulfillmentHold;
    productNameById: Map<string, string>;
    expanded: boolean;
    onToggle: () => void;
    fulfillPending: boolean;
    retryPending: boolean;
    onFulfill: () => void;
    onRetryFulfillment: () => void;
    onCancel: () => Promise<void>;
    onDispatch: () => void;
    onLinkLine: (line: OrderLine) => void;
}) {
    const { t } = useTranslation();
    const [nowMs] = useState(() => Date.now());
    const activeLines = order.order_lines.filter((l) => l.status === 'active');
    const itemCount = activeLines.reduce((n, l) => n + l.quantity, 0);
    // No product_id ⇒ fulfill_order deducts nothing for that line and it never reaches roasting needs.
    const unmappedCount = activeLines.filter((l) => !l.product_id).length;
    const { cancelled, fulfilled, canFulfill, canDispatch } = orderActionFlags(order, dispatch);
    const shortages = (hold?.shortages ?? []) as FulfillmentHoldShortage[];
    const holdReason = hold?.reason ?? null;
    const isNoStockDemandHold = holdReason === 'no_stock_demand';
    const canRetry = canRetryHold({
        hold: !!hold,
        fulfilled,
        cancelled,
        status: order.status,
    });
    // Local cancel restores product stock; channel-platform cancellations are synced FROM the platform
    // (webhook and/or poll — Naver has no webhook, cancels arrive via poll claim statuses), so manual-only
    // local cancel avoids double-restoring.
    const canCancel = order.platform === 'manual' && !cancelled;
    const sentDelayed =
        dispatch?.status === 'sent' &&
        !!dispatch.sent_at &&
        nowMs - new Date(dispatch.sent_at).getTime() > 30 * 60 * 1000;
    // defaultValue: no typed key augmentation, so an unknown status from the platform falls back to
    // the raw value instead of rendering the key path.
    const statusLabel =
        !cancelled && fulfilled
            ? t('orders.order.fulfilled')
            : t(`orders.status.${order.status}`, { defaultValue: order.status });

    return (
        <Fragment>
            <tr className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61] dark:hover:bg-surface-elevated/40">
                <td className="px-4 py-3.5 font-mono text-[13px] text-secondary">
                    {formatDateShort(order.ordered_at)}
                </td>
                <td className="px-4 py-3.5">
                    <Badge tone="soft" size="sm">
                        {t(`orders.channel.platform.${order.platform}`, { defaultValue: order.platform })}
                    </Badge>
                </td>
                <td className="px-4 py-3.5 text-[13px] text-primary tracking-[0.14px]">{order.buyer_name ?? '—'}</td>
                <td className="px-4 py-3.5 font-mono text-[13px] text-secondary">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {/* Toggle lives on the quantity, away from the action buttons in the last cell —
                            a whole-row click target would force stopPropagation on every one of them. */}
                        <button
                            type="button"
                            onClick={onToggle}
                            aria-expanded={expanded}
                            className="inline-flex cursor-pointer items-center gap-1 rounded border-none bg-transparent p-0 font-mono text-[13px] text-secondary hover:text-primary"
                        >
                            {expanded ? (
                                <ChevronDown size={13} strokeWidth={1.75} />
                            ) : (
                                <ChevronRight size={13} strokeWidth={1.75} />
                            )}
                            {itemCount}
                        </button>
                        {unmappedCount > 0 ? (
                            <Badge
                                tone="warn"
                                size="sm"
                                icon={<AlertTriangle size={11} strokeWidth={1.75} />}
                                title={t('orders.order.unmappedHelp')}
                            >
                                {t('orders.order.unmapped', { n: unmappedCount })}
                            </Badge>
                        ) : null}
                    </div>
                </td>
                <td className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={orderStatusTone(order.status, fulfilled)} size="sm">
                            {statusLabel}
                        </Badge>
                        {dispatch ? (
                            <Badge tone={dispatchTone(dispatch.status, sentDelayed)} size="sm">
                                {sentDelayed
                                    ? t('orders.dispatch.delayed')
                                    : t(`orders.dispatch.status.${dispatch.status}`, {
                                          defaultValue: dispatch.status,
                                      })}
                            </Badge>
                        ) : null}
                        {hold ? (
                            <Badge tone="warn" size="sm" icon={<AlertTriangle size={11} strokeWidth={1.75} />}>
                                {t(stockHoldBadgeKey(holdReason))}
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
                        {canRetry ? (
                            <GhostButton onClick={onRetryFulfillment} disabled={retryPending}>
                                {t('orders.order.retryFulfillment')}
                            </GhostButton>
                        ) : null}
                        {canFulfill && !canRetry ? (
                            <GhostButton
                                onClick={onFulfill}
                                disabled={fulfillPending}
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
            {expanded ? (
                <tr className="border-b border-border-subtle dark:border-[#585d61]">
                    <td colSpan={6} className="bg-surface/40 px-4 py-3 dark:bg-surface-elevated/20">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('orders.order.lines')}
                        </p>
                        {isNoStockDemandHold ? (
                            <p className="mb-3 text-[12px] text-amber-800 dark:text-amber-300">
                                {t('orders.order.stockHoldNoDemand')}
                            </p>
                        ) : shortages.length > 0 ? (
                            <ul className="mb-3 space-y-1 text-[12px] text-amber-800 dark:text-amber-300">
                                {shortages.map((s) => (
                                    <li key={s.order_line_id}>
                                        {t('orders.order.stockHoldLine', {
                                            product:
                                                productNameById.get(s.product_id) ??
                                                t('orders.order.stockHoldUnknownProduct'),
                                            required: s.required_units,
                                            available: s.available_units,
                                        })}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        {activeLines.length === 0 ? (
                            <p className="text-[12px] text-muted">—</p>
                        ) : (
                            <ul className="max-h-32 space-y-1.5 overflow-y-auto">
                                {activeLines.map((l) => (
                                    <li
                                        key={l.id}
                                        className="flex items-center gap-2 font-mono text-[12px] text-secondary"
                                    >
                                        <span className="truncate">{l.title}</span>
                                        {l.product_id ? null : cancelled || fulfilled ? (
                                            <AlertTriangle
                                                size={11}
                                                strokeWidth={1.75}
                                                className="shrink-0 text-amber-600 dark:text-amber-400"
                                                role="img"
                                                aria-label={t('orders.order.unmappedHelp')}
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => onLinkLine(l)}
                                                title={t('orders.order.unmappedHelp')}
                                                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-amber-500/40 bg-transparent px-2 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                                            >
                                                <AlertTriangle size={11} strokeWidth={1.75} />
                                                {t('orders.mapping.linkButton')}
                                            </button>
                                        )}
                                        <span className="ml-auto shrink-0 text-muted">× {l.quantity}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </td>
                </tr>
            ) : null}
        </Fragment>
    );
}
