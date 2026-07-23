import { useActiveWorkspace } from '@entities/organization';
import { type Product, useDeleteProduct, useProducts } from '@entities/product';
import { useProductStock } from '@entities/product-stock-event';
import { usePackageProduct } from '@features/package-product';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { AddProductModal } from '@widgets/add-product-modal';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProductsTableSkeleton } from './OrdersSkeleton';
import { dangerIconBtn, EmptyState, GhostButton, iconBtn } from './orderUi';

export function ProductsTab() {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: products = [], isLoading } = useProducts(userId);
    const { data: stock = {} } = useProductStock(userId);
    const deleteProduct = useDeleteProduct(userId);
    const { packageProduct } = usePackageProduct();
    const [showAdd, setShowAdd] = useState(false);
    const [editing, setEditing] = useState<Product | null>(null);

    const openInbound = (p: Product) => {
        // ponytail: window.prompt for MVP inbound; richer modal if roasters want batch-linked entry
        const raw = window.prompt(t('orders.product.inboundPrompt', { name: p.name }));
        if (raw == null) return;
        const units = Number(raw);
        if (Number.isFinite(units) && units > 0) void packageProduct({ productId: p.id, units });
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
