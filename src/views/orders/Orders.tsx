import { type OrderWithLines, useOrders } from '@entities/order';
import { type Product, useDeleteProduct, useProducts } from '@entities/product';
import { useProductStock } from '@entities/product-stock-event';
import {
    type ChannelPlatform,
    type SalesChannelConnection,
    useDisconnectChannel,
    useSalesChannels,
    useSyncOrders,
} from '@entities/sales-channel';
import { useAddFinishedGoods } from '@features/finished-goods-inbound';
import { useFulfillOrder } from '@features/fulfill-order';
import { FEATURE, useFeature } from '@shared/lib/features';
import { formatDateShort } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { AddOrderModal } from '@widgets/add-order-modal';
import { AddProductModal } from '@widgets/add-product-modal';
import { ConnectChannelModal } from '@widgets/connect-channel-modal';
import { RoastingRequirementsCard } from '@widgets/roasting-requirements-card';
import { Link2, Lock, Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type OrdersProps = { onUpgrade?: () => void };
type Tab = 'orders' | 'products' | 'channels';

export const Orders = ({ onUpgrade }: OrdersProps) => {
    const { t } = useTranslation();
    const canOrders = useFeature(FEATURE.orderIntegration);
    const [tab, setTab] = useState<Tab>('orders');

    if (!canOrders) {
        return (
            <PageLayout>
                <PageHeader title={t('orders.title')} subtitle={t('orders.locked.subtitle')} />
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 text-center dark:border-[#585d61]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface">
                        <Lock size={22} className="text-muted" />
                    </div>
                    <div>
                        <p className="text-[15px] font-medium text-primary">{t('orders.locked.title')}</p>
                        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">
                            {t('orders.locked.description')}
                        </p>
                    </div>
                    {onUpgrade ? (
                        <button
                            type="button"
                            onClick={onUpgrade}
                            className="rounded-full bg-primary px-5 py-2 text-xs font-medium text-white"
                        >
                            {t('orders.locked.cta')}
                        </button>
                    ) : null}
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />

            <div className="mb-5 flex gap-1 border-b border-border-subtle dark:border-[#585d61]">
                {(['orders', 'products', 'channels'] as Tab[]).map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium transition ${
                            tab === id
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted hover:text-secondary'
                        }`}
                    >
                        {t(`orders.tab.${id}`)}
                    </button>
                ))}
            </div>

            {tab === 'orders' ? <OrdersTab /> : tab === 'products' ? <ProductsTab /> : <ChannelsTab />}
        </PageLayout>
    );
};

function OrdersTab() {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: orders = [], isLoading } = useOrders(userId);
    const fulfill = useFulfillOrder();
    const [showAdd, setShowAdd] = useState(false);

    return (
        <div className="space-y-5">
            <RoastingRequirementsCard />

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-white"
                >
                    <Plus size={14} />
                    {t('orders.order.newTitle')}
                </button>
            </div>

            {isLoading ? (
                <p className="text-sm text-muted">{t('orders.loading')}</p>
            ) : orders.length === 0 ? (
                <div className="rounded-xl bg-main-bg px-4 py-16 text-center text-[13px] text-muted dark:border dark:border-[#585d61]">
                    {t('orders.order.empty')}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                {['date', 'platform', 'buyer', 'items', 'status', 'action'].map((c) => (
                                    <th
                                        key={c}
                                        className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted"
                                    >
                                        {t(`orders.order.col.${c}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((o) => (
                                <OrderRow key={o.id} order={o} onFulfill={() => fulfill.mutate(o.id)} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <AddOrderModal open={showAdd} onClose={() => setShowAdd(false)} />
        </div>
    );
}

function OrderRow({ order, onFulfill }: { order: OrderWithLines; onFulfill: () => void }) {
    const { t } = useTranslation();
    const itemCount = order.order_lines.filter((l) => l.status === 'active').reduce((n, l) => n + l.quantity, 0);
    const fulfilled = !!order.fulfilled_at;
    const canFulfill = !fulfilled && (order.status === 'paid' || order.status === 'preparing');

    return (
        <tr className="border-b border-border-subtle last:border-0 dark:border-[#585d61]">
            <td className="px-4 py-3 font-mono text-[13px] text-secondary">{formatDateShort(order.ordered_at)}</td>
            <td className="px-4 py-3 text-[12px] text-muted">
                {order.platform === 'manual'
                    ? t('orders.order.manual')
                    : t(`orders.channel.platform.${order.platform}`, { defaultValue: order.platform })}
            </td>
            <td className="px-4 py-3 text-[13px] text-primary">{order.buyer_name ?? '—'}</td>
            <td className="px-4 py-3 font-mono text-[13px] text-secondary">{itemCount}</td>
            <td className="px-4 py-3 text-[13px] text-secondary">
                {fulfilled ? t('orders.order.fulfilled') : t(`orders.status.${order.status}`)}
            </td>
            <td className="px-4 py-3">
                {canFulfill ? (
                    <button
                        type="button"
                        onClick={onFulfill}
                        className="rounded-full border border-border-subtle px-3 py-1.5 text-[11px] text-primary dark:border-[#585d61]"
                    >
                        {t('orders.order.fulfill')}
                    </button>
                ) : null}
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

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => {
                        setEditing(null);
                        setShowAdd(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-white"
                >
                    <Plus size={14} />
                    {t('orders.product.newTitle')}
                </button>
            </div>

            {isLoading ? (
                <p className="text-sm text-muted">{t('orders.loading')}</p>
            ) : products.length === 0 ? (
                <div className="rounded-xl bg-main-bg px-4 py-16 text-center text-[13px] text-muted dark:border dark:border-[#585d61]">
                    {t('orders.product.empty')}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                {['name', 'sku', 'weight', 'stock', 'action'].map((c) => (
                                    <th
                                        key={c}
                                        className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted"
                                    >
                                        {t(`orders.product.col.${c}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((p) => (
                                <tr
                                    key={p.id}
                                    className="border-b border-border-subtle last:border-0 dark:border-[#585d61]"
                                >
                                    <td className="px-4 py-3 text-[13px] font-medium text-primary">{p.name}</td>
                                    <td className="px-4 py-3 font-mono text-[12px] text-muted">{p.sku ?? '—'}</td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {p.net_weight_grams} g
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {stock[p.id] ?? 0}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => openInbound(p)}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-[11px] text-primary dark:border-[#585d61]"
                                            >
                                                <Package size={12} />
                                                {t('orders.product.inbound')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditing(p);
                                                    setShowAdd(true);
                                                }}
                                                className="rounded-full border border-border-subtle px-2.5 py-1 text-[11px] text-secondary dark:border-[#585d61]"
                                            >
                                                {t('common.edit')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (window.confirm(t('orders.product.deleteConfirm'))) {
                                                        deleteProduct.mutate(p.id);
                                                    }
                                                }}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-red-500"
                                                aria-label={t('common.delete')}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
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
            <p className="text-[13px] leading-relaxed text-muted">{t('orders.channel.intro')}</p>

            <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                    <button
                        key={p}
                        type="button"
                        onClick={() => setConnectPlatform(p)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-4 py-2 text-xs font-medium text-primary dark:border-[#585d61]"
                    >
                        <Link2 size={14} />
                        {t(`orders.channel.connect.${p}`)}
                    </button>
                ))}
                {channels.length > 0 ? (
                    <button
                        type="button"
                        disabled={sync.isPending}
                        onClick={() => void handleSync()}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={sync.isPending ? 'animate-spin' : ''} />
                        {t('orders.channel.syncAll')}
                    </button>
                ) : null}
            </div>

            {syncMsg ? <p className="text-[12px] text-secondary">{syncMsg}</p> : null}

            {isLoading ? (
                <p className="text-sm text-muted">{t('orders.loading')}</p>
            ) : channels.length === 0 ? (
                <div className="rounded-xl bg-main-bg px-4 py-16 text-center text-[13px] text-muted dark:border dark:border-[#585d61]">
                    {t('orders.channel.empty')}
                </div>
            ) : (
                <div className="space-y-3">
                    {channels.map((c) => (
                        <ChannelCard
                            key={c.id}
                            channel={c}
                            busy={sync.isPending || disconnect.isPending}
                            onSync={() => void handleSync(c.id)}
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
}: {
    channel: SalesChannelConnection;
    busy: boolean;
    onSync: () => void;
    onDisconnect: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-main-bg px-4 py-3 dark:border-[#585d61]">
            <div className="min-w-0">
                <p className="text-[14px] font-medium text-primary">
                    {channel.display_name || channel.shop_identifier}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                    {t(`orders.channel.platform.${channel.platform}`)} · {channel.shop_identifier} ·{' '}
                    {t(`orders.channel.status.${channel.status}`)}
                    {channel.last_polled_at
                        ? ` · ${t('orders.channel.lastSync', { at: formatDateShort(channel.last_polled_at) })}`
                        : ''}
                </p>
                {channel.last_error ? (
                    <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{channel.last_error}</p>
                ) : null}
            </div>
            <div className="flex gap-1.5">
                <button
                    type="button"
                    disabled={busy}
                    onClick={onSync}
                    className="rounded-full border border-border-subtle px-3 py-1.5 text-[11px] text-primary disabled:opacity-50 dark:border-[#585d61]"
                >
                    {t('orders.channel.sync')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={onDisconnect}
                    className="rounded-full border border-border-subtle px-3 py-1.5 text-[11px] text-secondary disabled:opacity-50 dark:border-[#585d61]"
                >
                    {t('orders.channel.disconnect')}
                </button>
            </div>
        </div>
    );
}
