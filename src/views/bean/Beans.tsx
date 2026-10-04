import { useBeans, useDeleteBean } from '@entities/bean/queries';
import type { BlendWithComponents } from '@entities/blend';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import type { Product } from '@entities/product';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
import { roastedStockEventApi, roastedStockKeys } from '@entities/roasted-stock-event';
import { useRoastingStore } from '@features/active-roast';
import { BlendRoastedModal } from '@features/blend-roasted';
import { FEATURE, useFeature } from '@shared/lib/features';
import type { Bean } from '@shared/types/database.types';
import type { View } from '@shared/types/view';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useQueryClient } from '@tanstack/react-query';
import { AddBeanModal } from '@widgets/add-bean-modal/ui/AddBeanModal';
import { AddBlendModal } from '@widgets/add-blend-modal';
import { BeanDetail } from '@widgets/bean-detail/ui/BeanDetail';
import { BeanList } from '@widgets/bean-list/ui/BeanList';
import { BlendList } from '@widgets/blend-list/ui/BlendList';
import { currencySymbol, formatAmount } from '@widgets/cost-calculator/lib/format';
import { ProductsTable } from '@widgets/products-table';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGreenInventoryAssets } from './model/useGreenInventoryAssets';
import { InventoryLocked } from './ui/InventoryLocked';
import { type InventoryTab, InventoryTabBar } from './ui/InventoryTabBar';
import { RoastedInventoryTab } from './ui/RoastedInventoryTab';

type BeansProps = {
    onNavigate?: (view: View) => void;
    onUpgrade?: () => void;
};

export const Beans = ({ onNavigate, onUpgrade }: BeansProps) => {
    const { t, i18n } = useTranslation();
    const qc = useQueryClient();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: beans = [], isLoading } = useBeans(userId);
    const {
        summary: assetSummary,
        stockSummaries,
        isLoading: assetsLoading,
        isError: assetsError,
    } = useGreenInventoryAssets(userId, beans);
    const { data: blends = [] } = useBlends(userId);
    const { mutate: deleteBean } = useDeleteBean(userId);
    const canRoasted = useFeature(FEATURE.roastedInventory);
    const canProducts = useFeature(FEATURE.productStock);

    // Warm inventory caches so tab switches are cache hits.
    useEffect(() => {
        if (!userId) return;
        if (canRoasted) {
            void qc.prefetchQuery({
                queryKey: roastedStockKeys.byUser(userId),
                queryFn: () => roastedStockEventApi.getUserRoastedStock(userId),
            });
        }
        if (canProducts) {
            void qc.prefetchQuery({
                queryKey: productStockKeys.byUser(userId),
                queryFn: () => productStockEventApi.getStockByUser(userId),
            });
        }
    }, [userId, canRoasted, canProducts, qc]);

    const [activeTab, setActiveTab] = useState<InventoryTab>('green');
    const [blendModalOpen, setBlendModalOpen] = useState(false);
    const [isBlendAddOpen, setIsBlendAddOpen] = useState(false);
    const [editingBlend, setEditingBlend] = useState<BlendWithComponents | null>(null);
    const [productAddOpen, setProductAddOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);

    const [tab, setTab] = useState<'single' | 'blend'>('single');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [modalConfig, setModalConfig] = useState<{
        tab: 'new' | 'restock' | 'edit';
        beanId: string | null;
        initialData?: Bean | null;
    }>({ tab: 'new', beanId: null });

    const openModal = (
        nextTab: 'new' | 'restock' | 'edit',
        beanId: string | null = null,
        initialData: Bean | null = null,
    ) => {
        setModalConfig({ tab: nextTab, beanId, initialData });
        setIsAddModalOpen(true);
    };

    const openBeanFirst = () => {
        setTab('single');
        openModal('new');
    };

    const openBlendAdd = () => {
        if (beans.length === 0) {
            openBeanFirst();
            return;
        }
        setIsBlendAddOpen(true);
    };

    const openProductAdd = () => {
        setEditingProduct(null);
        setProductAddOpen(true);
    };

    const selected = beans.find((b) => b.id === selectedId) ?? beans[0] ?? null;

    const affectedBlendNames = useMemo(
        () =>
            selected
                ? blends
                      .filter((blend) => blend.blend_components.some((c) => c.bean_id === selected.id))
                      .map((b) => b.name)
                : [],
        [selected, blends],
    );

    const emptyState = (
        <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-xl px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
            <div className="text-[13px] text-muted text-center leading-relaxed">
                {t('beans.empty.title')}
                <br />
                {t('beans.empty.description')}
            </div>
            <SurfaceButton
                onClick={() => openModal('new')}
                icon={<Plus size={14} strokeWidth={2} />}
                className="px-4 py-2"
            >
                {t('beans.addBean')}
            </SurfaceButton>
        </div>
    );

    const leftPanel = (
        <div className="flex flex-col gap-2">
            <BeanList
                beans={beans}
                isLoading={isLoading}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                search={search}
                onSearchChange={setSearch}
                stockSummaries={stockSummaries}
                assetByBeanId={assetSummary.byBeanId}
                assetsReady={!assetsLoading}
            />
        </div>
    );

    const detailPanel = (
        <BeanDetail
            bean={selected}
            isLoading={isLoading}
            affectedBlendNames={affectedBlendNames}
            assetLine={selected ? (assetSummary.byBeanId[selected.id] ?? null) : null}
            onEdit={(bean) => openModal('edit', bean.id, bean)}
            onRestock={(id) => openModal('restock', id)}
            onStartRoast={() => {
                useRoastingStore.getState().completeBatch();
                if (selected?.id) {
                    useRoastingStore.getState().setPendingBean(selected.id, selected.name);
                }
                onNavigate?.('roast');
            }}
            onDelete={(id) => {
                deleteBean(id, { onSuccess: () => setSelectedId(null) });
            }}
        />
    );

    const greenBody = (
        <>
            <div className="mb-4 flex items-end justify-between gap-3 border-b border-(--color-border) dark:border-[#585d61]">
                <div className="flex min-w-0">
                    <button
                        type="button"
                        className={`px-4 py-2 text-sm font-medium cursor-pointer ${tab === 'single' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'border-b-2 border-transparent text-(--color-muted)'}`}
                        onClick={() => setTab('single')}
                    >
                        {t('beans.tab.single')}
                    </button>
                    <button
                        type="button"
                        className={`px-4 py-2 text-sm font-medium cursor-pointer ${tab === 'blend' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'border-b-2 border-transparent text-(--color-muted)'}`}
                        onClick={() => setTab('blend')}
                    >
                        {t('beans.tab.blend')}
                    </button>
                </div>
                {tab === 'single' && beans.length > 0 && (
                    <div className="shrink-0 pb-2 text-right">
                        <div className="font-mono text-[13px] font-medium tracking-[0.14px] text-primary">
                            {assetsError
                                ? t('inventoryAsset.error')
                                : assetsLoading
                                  ? '—'
                                  : `${currencySymbol(i18n.language)}${formatAmount(assetSummary.totalAssetValue, i18n.language)}`}
                        </div>
                        {!assetsLoading && !assetsError && assetSummary.unevaluatedCount > 0 && (
                            <div className="text-[11px] tracking-[0.14px] text-muted">
                                {t('inventoryAsset.missingCostCount', {
                                    count: assetSummary.unevaluatedCount,
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {tab === 'single' &&
                (!isLoading && beans.length === 0 ? (
                    emptyState
                ) : (
                    <MasterDetailLayout left={leftPanel} detail={detailPanel} />
                ))}

            {tab === 'blend' && (
                <>
                    <BlendList
                        hasBeans={beans.length > 0}
                        onAddOpen={openBlendAdd}
                        onNeedBeans={openBeanFirst}
                        onEditOpen={(blend: BlendWithComponents) => setEditingBlend(blend)}
                    />
                    <AddBlendModal
                        key={editingBlend?.id ?? 'new'}
                        open={isBlendAddOpen || !!editingBlend}
                        onClose={() => {
                            setIsBlendAddOpen(false);
                            setEditingBlend(null);
                        }}
                        editing={editingBlend}
                    />
                </>
            )}
        </>
    );

    const headerActions = (() => {
        if (activeTab === 'green') {
            return (
                <PillButton
                    data-testid="beans-add-lot"
                    onClick={() => (tab === 'blend' ? openBlendAdd() : openModal('new'))}
                >
                    <Plus size={15} strokeWidth={2.5} />
                    {tab === 'blend' ? t('beans.blend.addBlend') : t('beans.addBeanLot')}
                </PillButton>
            );
        }
        if (activeTab === 'roasted' && canRoasted) {
            return (
                <PillButton onClick={() => setBlendModalOpen(true)}>{t('inventory.roasted.blendAction')}</PillButton>
            );
        }
        if (activeTab === 'products' && canProducts) {
            return (
                <PillButton onClick={openProductAdd}>
                    <Plus size={15} strokeWidth={2.5} />
                    {t('orders.product.newTitle')}
                </PillButton>
            );
        }
        return undefined;
    })();

    return (
        <PageLayout>
            <AddBeanModal
                open={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                userId={userId}
                existingBeans={beans}
                initialTab={modalConfig.tab}
                initialBeanId={modalConfig.beanId}
                initialData={modalConfig.initialData}
                onSuccess={(bean) => {
                    if (bean) setSelectedId(bean.id);
                }}
            />

            <PageHeader title={t('beans.title')} actions={headerActions} />

            <InventoryTabBar active={activeTab} onChange={setActiveTab} />

            {activeTab === 'green' && greenBody}

            {activeTab === 'roasted' &&
                (canRoasted ? <RoastedInventoryTab /> : <InventoryLocked tab="roasted" onUpgrade={onUpgrade} />)}

            {activeTab === 'products' &&
                (canProducts ? (
                    <ProductsTable
                        addOpen={productAddOpen}
                        onAddOpenChange={setProductAddOpen}
                        editing={editingProduct}
                        onEditingChange={setEditingProduct}
                    />
                ) : (
                    <InventoryLocked tab="products" onUpgrade={onUpgrade} />
                ))}

            <BlendRoastedModal open={blendModalOpen} onClose={() => setBlendModalOpen(false)} />
        </PageLayout>
    );
};
