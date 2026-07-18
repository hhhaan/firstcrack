import { useActiveWorkspace } from '@entities/organization';
import { useProducts } from '@entities/product';
import { useProductStock } from '@entities/product-stock-event';
import { usePackageProduct } from '@features/package-product';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const ProductsTab = () => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: products = [] } = useProducts(userId);
    const { data: stockByProduct = {} } = useProductStock(userId);
    const { packageProduct, isPending } = usePackageProduct();
    const [warning, setWarning] = useState<string | null>(null);
    const [unitsDraft, setUnitsDraft] = useState<Record<string, string>>({});

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

    const activeProducts = products.filter((p) => p.is_active);

    return (
        <div>
            {warning && (
                <div className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-[12px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    {warning}
                </div>
            )}
            {activeProducts.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-muted">{t('inventory.products.empty')}</div>
            ) : (
                <div className="grid gap-2">
                    {activeProducts.map((p) => (
                        <div
                            key={p.id}
                            className="flex items-center justify-between rounded-lg border border-border-subtle px-4 py-3 dark:border-[#585d61]"
                        >
                            <div>
                                <span className="text-[13px] font-medium text-primary">{p.name}</span>
                                <span className="ml-2 text-[11px] text-muted">
                                    {p.net_weight_grams}g{p.sku ? ` · ${p.sku}` : ''}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-[14px] font-medium text-primary">
                                    {stockByProduct[p.id] ?? 0} {t('inventory.products.unitSuffix')}
                                </span>
                                <input
                                    type="number"
                                    min={1}
                                    value={unitsDraft[p.id] ?? ''}
                                    onChange={(e) => setUnitsDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                                    placeholder="+"
                                    className="w-16 rounded border border-border-subtle bg-transparent px-1.5 py-0.5 text-right font-mono text-[13px] text-primary outline-none focus:border-border"
                                />
                                <button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() => void inbound(p.id)}
                                    className="rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-secondary hover:text-primary disabled:opacity-40"
                                >
                                    {t('inventory.products.inbound')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
