import { useBeans, useDeleteBean } from '@entities/bean/queries';
import { useBeanStockSummaries } from '@entities/bean-stock-event';
import type { BlendWithComponents } from '@entities/blend';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastingStore } from '@features/active-roast';
import { BlendRoastedModal } from '@features/blend-roasted';
import { FEATURE, useFeature } from '@shared/lib/features';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { Bean } from '@shared/types/database.types';
import type { View } from '@shared/types/view';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { AddBeanModal } from '@widgets/add-bean-modal/ui/AddBeanModal';
import { AddBlendModal } from '@widgets/add-blend-modal';
import { BeanDetail } from '@widgets/bean-detail/ui/BeanDetail';
import { BeanList } from '@widgets/bean-list/ui/BeanList';
import { BlendList } from '@widgets/blend-list/ui/BlendList';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type InventoryTab, InventoryTabBar } from './ui/InventoryTabBar';
import { LockedTabPanel } from './ui/LockedTabPanel';
import { ProductsTab } from './ui/ProductsTab';
import { RoastedInventoryTab } from './ui/RoastedInventoryTab';

export const Beans = ({ onNavigate }: { onNavigate?: (view: View) => void }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: beans = [], isLoading } = useBeans(userId);
    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);
    const { data: blends = [] } = useBlends(userId);
    const { mutate: deleteBean } = useDeleteBean(userId);
    const canRoasted = useFeature(FEATURE.roastedInventory);
    const canProducts = useFeature(FEATURE.productStock);

    const [activeTab, setActiveTab] = useState<InventoryTab>('green');
    const [blendModalOpen, setBlendModalOpen] = useState(false);
    const [isBlendAddOpen, setIsBlendAddOpen] = useState(false);
    const [editingBlend, setEditingBlend] = useState<BlendWithComponents | null>(null);

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
        tab: 'new' | 'restock' | 'edit',
        beanId: string | null = null,
        initialData: Bean | null = null,
    ) => {
        setModalConfig({ tab, beanId, initialData });
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
            />
        </div>
    );

    const detailPanel = (
        <BeanDetail
            bean={selected}
            isLoading={isLoading}
            affectedBlendNames={affectedBlendNames}
            onEdit={(bean) => openModal('edit', bean.id, bean)}
            onRestock={(id) => openModal('restock', id)}
            onStartRoast={() => {
                // Free roast from inventory must not keep a leftover schedule batch handoff.
                useRoastSessionStore.getState().completeBatch();
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
            <div className="flex border-b border-(--color-border) dark:border-[#585d61] mb-4">
                <button
                    type="button"
                    className={`px-4 py-2 text-sm font-medium cursor-pointer ${tab === 'single' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'text-(--color-muted)'}`}
                    onClick={() => setTab('single')}
                >
                    {t('beans.tab.single')}
                </button>
                <button
                    type="button"
                    className={`px-4 py-2 text-sm font-medium cursor-pointer ${tab === 'blend' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'text-(--color-muted)'}`}
                    onClick={() => setTab('blend')}
                >
                    {t('beans.tab.blend')}
                </button>
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

            <PageHeader
                title={t('beans.title')}
                actions={
                    activeTab === 'green' ? (
                        <PillButton onClick={() => (tab === 'blend' ? openBlendAdd() : openModal('new'))}>
                            <Plus size={15} strokeWidth={2.5} />
                            {tab === 'blend' ? t('beans.blend.addBlend') : t('beans.addBeanLot')}
                        </PillButton>
                    ) : undefined
                }
            />

            <InventoryTabBar active={activeTab} onChange={setActiveTab} />

            {activeTab === 'green' && greenBody}

            {activeTab === 'roasted' &&
                (canRoasted ? (
                    <RoastedInventoryTab onOpenBlending={() => setBlendModalOpen(true)} />
                ) : (
                    <LockedTabPanel
                        titleKey="inventory.locked.roastedTitle"
                        descriptionKey="inventory.locked.roastedDescription"
                        onUpgrade={() => onNavigate?.('pricing')}
                    />
                ))}

            <BlendRoastedModal open={blendModalOpen} onClose={() => setBlendModalOpen(false)} />

            {activeTab === 'products' &&
                (canProducts ? (
                    <ProductsTab />
                ) : (
                    <LockedTabPanel
                        titleKey="inventory.locked.productsTitle"
                        descriptionKey="inventory.locked.productsDescription"
                        onUpgrade={() => onNavigate?.('pricing')}
                    />
                ))}
        </PageLayout>
    );
};
