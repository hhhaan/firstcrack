import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { type Product, useDeleteProduct, useProducts } from '@entities/product';
import { useProductStock, useProductStockEvents } from '@entities/product-stock-event';
import { AdjustStockModal } from '@features/adjust-stock';
import { MapChannelProductModal } from '@features/map-channel-product';
import { usePackageProduct } from '@features/package-product';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { TableSkeleton } from '@shared/ui/TableSkeleton';
import { confirm } from '@tauri-apps/plugin-dialog';
import { AddProductModal } from '@widgets/add-product-modal';
import { Link2, Package, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ghostBtn =
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border-subtle bg-transparent px-3 py-1.5 text-[12px] font-medium tracking-[0.14px] text-secondary transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40 dark:border-[#585d61] dark:hover:bg-surface-elevated cursor-pointer';

const iconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-surface-elevated cursor-pointer';

const dangerIconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40 cursor-pointer';

const skeletonCols = [
    { width: '24%', bar: '70%' },
    { width: '12%', bar: '55%' },
    { width: '16%', bar: '60%' },
    { width: '10%', bar: '45%' },
    { width: '12%', bar: 36, height: 18, borderRadius: '9999px' },
    { width: '26%', bar: '90%' },
];

type Props = {
    addOpen: boolean;
    onAddOpenChange: (open: boolean) => void;
    editing: Product | null;
    onEditingChange: (product: Product | null) => void;
};

export const ProductsTable = ({ addOpen, onAddOpenChange, editing, onEditingChange }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: products = [], isLoading } = useProducts(userId);
    const { data: stockByProduct = {} } = useProductStock(userId);
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);
    const deleteProduct = useDeleteProduct(userId);
    const { packageProduct, isPending } = usePackageProduct();

    const [search, setSearch] = useState('');
    const [warning, setWarning] = useState<string | null>(null);
    const [unitsDraft, setUnitsDraft] = useState<Record<string, string>>({});
    const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
    const [mapProduct, setMapProduct] = useState<Product | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const openNew = () => {
        onEditingChange(null);
        onAddOpenChange(true);
    };

    const openEdit = (p: Product) => {
        onEditingChange(p);
        onAddOpenChange(true);
    };

    const resolveSource = (p: Product) => {
        if (p.bean_id) return beans.find((b) => b.id === p.bean_id)?.name ?? '—';
        if (p.blend_id) return blends.find((b) => b.id === p.blend_id)?.name ?? '—';
        return t('inventory.products.sourceNone');
    };

    const activeProducts = useMemo(() => {
        const q = search.trim().toLowerCase();
        return products
            .filter((p) => p.is_active)
            .filter((p) => {
                if (!q) return true;
                const source = p.bean_id
                    ? (beans.find((b) => b.id === p.bean_id)?.name ?? '')
                    : p.blend_id
                      ? (blends.find((b) => b.id === p.blend_id)?.name ?? '')
                      : '';
                return (
                    p.name.toLowerCase().includes(q) ||
                    (p.sku ?? '').toLowerCase().includes(q) ||
                    source.toLowerCase().includes(q)
                );
            });
    }, [products, search, beans, blends]);

    const inbound = async (productId: string) => {
        const units = Number(unitsDraft[productId]);
        if (!Number.isInteger(units) || units <= 0) return;
        const { shortageGrams } = await packageProduct({ productId, units });
        setWarning(
            shortageGrams != null
                ? t('inventory.products.shortageWarning', { kg: (shortageGrams / 1000).toFixed(2) })
                : null,
        );
        setUnitsDraft((d) => ({ ...d, [productId]: '' }));
    };

    const hasActive = products.some((p) => p.is_active);

    return (
        <div className="space-y-3">
            {warning && (
                <div className="rounded-md bg-amber-100 px-3 py-2 text-[12px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    {warning}
                </div>
            )}

            <div className="flex min-w-0 max-w-xs items-center gap-2 rounded-lg bg-main-bg px-3 py-[9px] dark:border dark:border-[#585d61]">
                <Search size={14} strokeWidth={2} className="shrink-0 text-muted" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('inventory.products.searchPlaceholder')}
                    className="w-full border-none bg-transparent font-body text-[13px] tracking-[0.14px] text-primary outline-none"
                />
            </div>

            {isLoading ? (
                <TableSkeleton cols={skeletonCols} rows={5} minWidth="640px" />
            ) : !hasActive ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-[#585d61]">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                        <Package size={20} strokeWidth={1.5} />
                    </div>
                    <p className="max-w-sm text-[13px] leading-relaxed tracking-[0.14px] text-muted">
                        {t('inventory.products.empty')}
                    </p>
                    <SurfaceButton onClick={openNew} icon={<Plus size={14} strokeWidth={2} />} className="px-4 py-2">
                        {t('orders.product.newTitle')}
                    </SurfaceButton>
                </div>
            ) : activeProducts.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-muted">{t('inventory.products.noMatch')}</div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                    <table className="w-full min-w-[640px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                {(['name', 'sku', 'source', 'weight', 'stock'] as const).map((c) => (
                                    <th
                                        key={c}
                                        className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted"
                                    >
                                        {t(`inventory.products.col.${c}`)}
                                    </th>
                                ))}
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {activeProducts.map((p) => {
                                const units = stockByProduct[p.id] ?? 0;
                                const low = units <= 0;
                                const expanded = expandedId === p.id;
                                return (
                                    <Fragment key={p.id}>
                                        <tr className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61] dark:hover:bg-surface-elevated/40">
                                            <td className="px-4 py-3.5 text-[13px] font-medium tracking-[0.14px] text-primary">
                                                <button
                                                    type="button"
                                                    className="text-left hover:underline"
                                                    onClick={() => setExpandedId((id) => (id === p.id ? null : p.id))}
                                                >
                                                    {p.name}
                                                </button>
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-[12px] text-muted">
                                                {p.sku ?? '—'}
                                            </td>
                                            <td className="px-4 py-3.5 text-[12px] tracking-[0.14px] text-secondary">
                                                {resolveSource(p)}
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-[13px] text-secondary">
                                                {p.net_weight_grams} g
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <Badge tone={low ? 'bad' : 'good'} size="sm">
                                                    {units} {t('inventory.products.unitSuffix')}
                                                </Badge>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3.5">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={unitsDraft[p.id] ?? ''}
                                                        onChange={(e) =>
                                                            setUnitsDraft((d) => ({ ...d, [p.id]: e.target.value }))
                                                        }
                                                        placeholder="+"
                                                        className="w-14 rounded border border-border-subtle bg-transparent px-1.5 py-1 text-right font-mono text-[12px] text-primary outline-none focus:border-border dark:border-[#585d61]"
                                                    />
                                                    <button
                                                        type="button"
                                                        disabled={isPending}
                                                        onClick={() => void inbound(p.id)}
                                                        className={ghostBtn}
                                                    >
                                                        <Package size={13} strokeWidth={1.75} />
                                                        {t('inventory.products.inbound')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={ghostBtn}
                                                        onClick={() => setAdjustProduct(p)}
                                                    >
                                                        <SlidersHorizontal size={13} strokeWidth={1.75} />
                                                        {t('inventory.products.adjust')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={ghostBtn}
                                                        onClick={() => setMapProduct(p)}
                                                    >
                                                        <Link2 size={13} strokeWidth={1.75} />
                                                        {t('orders.mapping.channelButton')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(p)}
                                                        className={iconBtn}
                                                        aria-label={t('common.edit')}
                                                    >
                                                        <Pencil size={14} strokeWidth={1.75} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            if (await confirm(t('orders.product.deleteConfirm'))) {
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
                                        {expanded ? <ProductHistoryRow userId={userId} productId={p.id} /> : null}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {adjustProduct && (
                <AdjustStockModal
                    kind="product"
                    open
                    onClose={() => setAdjustProduct(null)}
                    productId={adjustProduct.id}
                    name={adjustProduct.name}
                    currentUnits={stockByProduct[adjustProduct.id] ?? 0}
                />
            )}

            <MapChannelProductModal product={mapProduct} onClose={() => setMapProduct(null)} />

            <AddProductModal
                open={addOpen}
                onClose={() => {
                    onAddOpenChange(false);
                    onEditingChange(null);
                }}
                editing={editing}
            />
        </div>
    );
};

const PRODUCT_EVENT_I18N: Record<string, string> = {
    roast_inbound: 'inventory.event.roast_inbound',
    packaging: 'inventory.event.packaging',
    order_fulfillment: 'inventory.event.order_fulfillment',
    order_cancel: 'inventory.event.order_cancel',
    adjustment: 'inventory.event.adjustment',
    write_off: 'inventory.event.write_off',
};

function ProductHistoryRow({ userId, productId }: { userId: string; productId: string }) {
    const { t } = useTranslation();
    const { data: events = [], isLoading } = useProductStockEvents(userId, productId, true);

    return (
        <tr className="border-b border-border-subtle dark:border-[#585d61]">
            <td colSpan={6} className="bg-surface/40 px-4 py-3 dark:bg-surface-elevated/20">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                    {t('inventory.event.history')}
                </p>
                {isLoading ? (
                    <p className="text-[12px] text-muted">…</p>
                ) : events.length === 0 ? (
                    <p className="text-[12px] text-muted">—</p>
                ) : (
                    <ul className="max-h-28 space-y-1.5 overflow-y-auto">
                        {events.slice(0, 20).map((ev) => (
                            <li key={ev.id} className="flex gap-2 font-mono text-[12px] text-secondary">
                                <span className={ev.delta_units > 0 ? 'text-palette-green' : 'text-palette-purple'}>
                                    {ev.delta_units > 0 ? '+' : ''}
                                    {ev.delta_units}
                                </span>
                                <span>
                                    {t(PRODUCT_EVENT_I18N[ev.event_type] ?? 'inventory.event.adjustment', {
                                        defaultValue: ev.event_type,
                                    })}
                                </span>
                                {ev.note ? <span className="text-muted">— {ev.note}</span> : null}
                                <span className="ml-auto text-muted">
                                    {new Date(ev.created_at).toLocaleDateString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </td>
        </tr>
    );
}
