import { type OrderWithLines, useOrders } from '@entities/order';
import { type OrderDispatch, useOrderDispatches } from '@entities/order-dispatch';
import { type Product, useDeleteProduct, useProducts } from '@entities/product';
import { useProductStock } from '@entities/product-stock-event';
import {
    type ChannelPlatform,
    type SalesChannelConnection,
    useDisconnectChannel,
    useSalesChannels,
    useSetAutoFulfill,
    useSyncOrders,
} from '@entities/sales-channel';
import { DispatchModal } from '@features/dispatch-order';
import { useAddFinishedGoods } from '@features/finished-goods-inbound';
import { useFulfillOrder } from '@features/fulfill-order';
import { FEATURE, useFeature } from '@shared/lib/features';
import { formatDateShort } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import { Badge, type BadgeTone } from '@shared/ui/Badge';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { AddOrderModal } from '@widgets/add-order-modal';
import { AddProductModal } from '@widgets/add-product-modal';
import { ConnectChannelModal } from '@widgets/connect-channel-modal';
import { RoastingRequirementsCard } from '@widgets/roasting-requirements-card';
import { Link2, Lock, Package, Pencil, Plus, RefreshCw, ShoppingBag, Store, Trash2, Truck } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChannelsListSkeleton, OrdersTableSkeleton, ProductsTableSkeleton } from './ui/OrdersSkeleton';

type OrdersProps = { onUpgrade?: () => void };
type Tab = 'orders' | 'products' | 'channels';

const ghostBtn =
    'inline-flex items-center justify-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-3 py-1.5 text-[12px] font-medium tracking-[0.14px] text-secondary transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40 dark:border-[#585d61] dark:hover:bg-surface-elevated cursor-pointer';

const iconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-surface-elevated cursor-pointer';

const dangerIconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40 cursor-pointer';

const ORDER_STATUS_EN: Record<string, string> = {
    pending: 'Pending',
    paid: 'Paid',
    preparing: 'Preparing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
};

const DISPATCH_STATUS_EN: Record<string, string> = {
    pending: 'Dispatch pending',
    sent: 'Ship requested',
    confirmed: 'Shipped (confirmed)',
    failed: 'Ship failed',
};

const PLATFORM_EN: Record<string, string> = {
    manual: 'Manual',
    naver: 'Naver',
    cafe24: 'Cafe24',
    shopify: 'Shopify',
};

const CHANNEL_STATUS_EN: Record<string, string> = {
    pending: 'Pending',
    active: 'Active',
    error: 'Error',
    disabled: 'Disabled',
};

function GhostButton({
    className = '',
    children,
    type = 'button',
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
    return (
        <button type={type} className={`${ghostBtn} ${className}`} {...props}>
            {children}
        </button>
    );
}

function EmptyState({ icon, message, action }: { icon: ReactNode; message: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-[#585d61]">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                {icon}
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-muted tracking-[0.14px]">{message}</p>
            {action}
        </div>
    );
}

function orderStatusTone(status: string, fulfilled: boolean): BadgeTone {
    if (fulfilled) return 'good';
    switch (status) {
        case 'paid':
        case 'preparing':
            return 'blue';
        case 'shipped':
        case 'delivered':
            return 'green';
        case 'cancelled':
        case 'refunded':
            return 'bad';
        case 'pending':
            return 'muted';
        default:
            return 'neutral';
    }
}

function channelStatusTone(status: string): BadgeTone {
    switch (status) {
        case 'active':
            return 'good';
        case 'error':
            return 'bad';
        case 'pending':
            return 'warn';
        case 'disabled':
            return 'muted';
        default:
            return 'neutral';
    }
}

export const Orders = ({ onUpgrade }: OrdersProps) => {
    const { t } = useTranslation();
    const canOrders = useFeature(FEATURE.orderIntegration);
    const [tab, setTab] = useState<Tab>('orders');

    if (!canOrders) {
        return (
            <PageLayout>
                <PageHeader title={t('orders.title')} subtitle={t('orders.locked.subtitle')} />
                <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 text-center dark:border-[#585d61]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                        <Lock size={22} strokeWidth={1.5} />
                    </div>
                    <div>
                        <p className="text-[15px] font-medium text-primary tracking-[0.14px]">
                            {t('orders.locked.title')}
                        </p>
                        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted tracking-[0.14px]">
                            {t('orders.locked.description')}
                        </p>
                    </div>
                    {onUpgrade ? <PillButton onClick={onUpgrade}>{t('orders.locked.cta')}</PillButton> : null}
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />

            <div className="mb-6 flex gap-1 border-b border-border-subtle dark:border-[#585d61]">
                {(['orders', 'products', 'channels'] as Tab[]).map((id) => {
                    const active = tab === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium tracking-[0.14px] transition-colors cursor-pointer ${
                                active
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted hover:text-secondary'
                            }`}
                        >
                            {t(`orders.tab.${id}`)}
                        </button>
                    );
                })}
            </div>

            {tab === 'orders' ? <OrdersTab /> : tab === 'products' ? <ProductsTab /> : <ChannelsTab />}
        </PageLayout>
    );
};

function OrdersTab() {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: orders = [], isLoading } = useOrders(userId);
    const { data: dispatches = [] } = useOrderDispatches(userId);
    const fulfill = useFulfillOrder();
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

function dispatchTone(status: string, delayed: boolean): BadgeTone {
    if (delayed) return 'warn';
    switch (status) {
        case 'confirmed':
            return 'good';
        case 'sent':
            return 'blue';
        case 'failed':
            return 'bad';
        default:
            return 'muted';
    }
}

function OrderRow({
    order,
    dispatch,
    onFulfill,
    onDispatch,
}: {
    order: OrderWithLines;
    dispatch?: OrderDispatch;
    onFulfill: () => void;
    onDispatch: () => void;
}) {
    const { t } = useTranslation();
    const [nowMs] = useState(() => Date.now());
    const itemCount = order.order_lines.filter((l) => l.status === 'active').reduce((n, l) => n + l.quantity, 0);
    const fulfilled = !!order.fulfilled_at;
    const canFulfill = !fulfilled && (order.status === 'paid' || order.status === 'preparing');
    const canDispatch =
        order.platform !== 'manual' &&
        fulfilled &&
        !!order.connection_id &&
        (!dispatch || dispatch.status === 'failed');
    const sentDelayed =
        dispatch?.status === 'sent' &&
        !!dispatch.sent_at &&
        nowMs - new Date(dispatch.sent_at).getTime() > 30 * 60 * 1000;
    const statusLabel = fulfilled ? 'Fulfilled' : (ORDER_STATUS_EN[order.status] ?? order.status);

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

function ProductsTab() {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: products = [], isLoading } = useProducts(userId);
    const { data: stock = {} } = useProductStock(userId);
    const deleteProduct = useDeleteProduct(userId);
    const addInbound = useAddFinishedGoods();
    const [showAdd, setShowAdd] = useState(false);
    const [editing, setEditing] = useState<Product | null>(null);

    const openInbound = (p: Product) => {
        // ponytail: window.prompt for MVP inbound; richer modal if roasters want batch-linked entry
        const raw = window.prompt(t('orders.product.inboundPrompt', { name: p.name }));
        if (raw == null) return;
        const units = Number(raw);
        if (Number.isFinite(units) && units > 0) addInbound.mutate({ productId: p.id, units });
    };

    const openNew = () => {
        setEditing(null);
        setShowAdd(true);
    };

    return (
        <div className="space-y-4">
            {isLoading ? (
                <ProductsTableSkeleton />
            ) : products.length === 0 ? (
                <EmptyState
                    icon={<Package size={20} strokeWidth={1.5} />}
                    message={t('orders.product.empty')}
                    action={
                        <SurfaceButton
                            onClick={openNew}
                            icon={<Plus size={14} strokeWidth={2} />}
                            className="px-4 py-2"
                        >
                            {t('orders.product.newTitle')}
                        </SurfaceButton>
                    }
                />
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                {['name', 'sku', 'weight', 'stock', 'action'].map((c) => (
                                    <th
                                        key={c}
                                        className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted"
                                    >
                                        {c === 'action' ? '' : t(`orders.product.col.${c}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((p) => {
                                const units = stock[p.id] ?? 0;
                                const low = units <= 0;
                                return (
                                    <tr
                                        key={p.id}
                                        className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61] dark:hover:bg-surface-elevated/40"
                                    >
                                        <td className="px-4 py-3.5 text-[13px] font-medium text-primary tracking-[0.14px]">
                                            {p.name}
                                        </td>
                                        <td className="px-4 py-3.5 font-mono text-[12px] text-muted">{p.sku ?? '—'}</td>
                                        <td className="px-4 py-3.5 font-mono text-[13px] text-secondary">
                                            {p.net_weight_grams} g
                                        </td>
                                        <td className="px-4 py-3.5">
                                            <Badge tone={low ? 'bad' : 'soft'} size="sm">
                                                {units}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3.5">
                                            <div className="flex items-center justify-end gap-1">
                                                <GhostButton onClick={() => openInbound(p)}>
                                                    <Package size={13} strokeWidth={1.75} />
                                                    {t('orders.product.inbound')}
                                                </GhostButton>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditing(p);
                                                        setShowAdd(true);
                                                    }}
                                                    className={iconBtn}
                                                    aria-label={t('common.edit')}
                                                >
                                                    <Pencil size={14} strokeWidth={1.75} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (window.confirm(t('orders.product.deleteConfirm'))) {
                                                            deleteProduct.mutate(p.id);
                                                        }
                                                    }}
                                                    className={dangerIconBtn}
                                                    aria-label={t('common.delete')}
                                                >
                                                    <Trash2 size={14} strokeWidth={1.75} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <AddProductModal open={showAdd} onClose={() => setShowAdd(false)} editing={editing} />
        </div>
    );
}

const PLATFORMS: ChannelPlatform[] = ['naver', 'cafe24', 'shopify'];

function ChannelsTab() {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: channels = [], isLoading } = useSalesChannels(userId);
    const disconnect = useDisconnectChannel(userId);
    const sync = useSyncOrders(userId);
    const setAutoFulfill = useSetAutoFulfill(userId);
    const [connectPlatform, setConnectPlatform] = useState<ChannelPlatform | null>(null);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);

    const handleSync = async (connectionId?: string) => {
        setSyncMsg(null);
        try {
            const res = await sync.mutateAsync(connectionId);
            const total = res.results.reduce((n, r) => n + (r.upserted ?? 0), 0);
            const failed = res.results.filter((r) => !r.ok);
            setSyncMsg(
                failed.length
                    ? t('orders.channel.syncPartial', { n: total, err: failed[0]?.error ?? '' })
                    : t('orders.channel.syncOk', { n: total }),
            );
        } catch (e) {
            setSyncMsg(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <div className="space-y-5">
            <p className="text-[13px] leading-relaxed text-muted tracking-[0.14px]">{t('orders.channel.intro')}</p>

            <div className="flex flex-wrap items-center gap-2">
                {PLATFORMS.map((p) => (
                    <GhostButton key={p} onClick={() => setConnectPlatform(p)} className="px-4 py-2 text-[13px]">
                        <Link2 size={14} strokeWidth={1.75} />
                        {t(`orders.channel.connect.${p}`)}
                    </GhostButton>
                ))}
                {channels.length > 0 ? (
                    <SurfaceButton
                        onClick={() => void handleSync()}
                        disabled={sync.isPending}
                        icon={
                            <RefreshCw
                                size={13}
                                strokeWidth={2}
                                className={sync.isPending ? 'animate-spin' : undefined}
                            />
                        }
                    >
                        {t('orders.channel.syncAll')}
                    </SurfaceButton>
                ) : null}
            </div>

            {syncMsg ? (
                <p className="rounded-lg bg-surface px-3 py-2 text-[12px] text-secondary tracking-[0.14px] dark:bg-surface-elevated">
                    {syncMsg}
                </p>
            ) : null}

            {isLoading ? (
                <ChannelsListSkeleton />
            ) : channels.length === 0 ? (
                <EmptyState icon={<Store size={20} strokeWidth={1.5} />} message={t('orders.channel.empty')} />
            ) : (
                <div className="space-y-2.5">
                    {channels.map((c) => (
                        <ChannelCard
                            key={c.id}
                            channel={c}
                            busy={sync.isPending || disconnect.isPending || setAutoFulfill.isPending}
                            onSync={() => void handleSync(c.id)}
                            onToggleAutoFulfill={(enabled) => setAutoFulfill.mutate({ connectionId: c.id, enabled })}
                            onDisconnect={() => {
                                if (window.confirm(t('orders.channel.disconnectConfirm'))) {
                                    disconnect.mutate(c.id);
                                }
                            }}
                        />
                    ))}
                </div>
            )}

            <ConnectChannelModal
                open={!!connectPlatform}
                platform={connectPlatform}
                onClose={() => setConnectPlatform(null)}
            />
        </div>
    );
}

function ChannelCard({
    channel,
    busy,
    onSync,
    onDisconnect,
    onToggleAutoFulfill,
}: {
    channel: SalesChannelConnection;
    busy: boolean;
    onSync: () => void;
    onDisconnect: () => void;
    onToggleAutoFulfill: (enabled: boolean) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-main-bg px-4 py-3.5 transition-colors hover:border-black/10 dark:border-[#585d61] dark:hover:border-[#6c6a6b]">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14px] font-medium text-primary tracking-[0.14px]">
                        {channel.display_name || channel.shop_identifier}
                    </p>
                    <Badge tone={channelStatusTone(channel.status)} size="sm">
                        {CHANNEL_STATUS_EN[channel.status] ?? channel.status}
                    </Badge>
                    <Badge tone="soft" size="sm">
                        {PLATFORM_EN[channel.platform] ?? channel.platform}
                    </Badge>
                </div>
                <p className="mt-1 text-[12px] text-muted tracking-[0.14px]">
                    {channel.shop_identifier}
                    {channel.last_polled_at
                        ? ` · ${t('orders.channel.lastSync', { at: formatDateShort(channel.last_polled_at) })}`
                        : ''}
                </p>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-secondary tracking-[0.14px]">
                    <input
                        type="checkbox"
                        className="rounded border-border-subtle"
                        checked={channel.auto_fulfill_on_shipped}
                        disabled={busy}
                        onChange={(e) => onToggleAutoFulfill(e.target.checked)}
                    />
                    {t('orders.channel.autoFulfill')}
                </label>
                {channel.last_error ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                        {channel.last_error}
                    </p>
                ) : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
                <GhostButton disabled={busy} onClick={onSync}>
                    <RefreshCw size={13} strokeWidth={1.75} />
                    {t('orders.channel.sync')}
                </GhostButton>
                <GhostButton
                    disabled={busy}
                    onClick={onDisconnect}
                    className="hover:text-red-500 hover:border-red-500/25"
                >
                    {t('orders.channel.disconnect')}
                </GhostButton>
            </div>
        </div>
    );
}
