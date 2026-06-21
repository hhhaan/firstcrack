import { useBeans, useDeleteBean } from '@entities/bean/queries';
import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { useRoastingStore } from '@features/active-roast';
import { useAuthStore } from '@shared/store/auth';
import type { Bean } from '@shared/types/database.types';
import type { View } from '@shared/types/view';
import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { AddBeanModal } from '@widgets/add-bean-modal/ui/AddBeanModal';
import { BeanDetail } from '@widgets/bean-detail/ui/BeanDetail';
import { BeanList } from '@widgets/bean-list/ui/BeanList';
import { BlendList } from '@widgets/blend-list/ui/BlendList';
import { Plus } from 'lucide-react';
import { useState } from 'react';

export const Beans = ({ onNavigate }: { onNavigate?: (view: View) => void }) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: beans = [], isLoading } = useBeans(userId);
    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);
    const { mutate: deleteBean } = useDeleteBean(userId);

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

    const selected = beans.find((b) => b.id === selectedId) ?? beans[0] ?? null;

    const emptyState = (
        <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-xl px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
            <div className="text-[13px] text-muted text-center leading-relaxed">
                등록된 원두가 없습니다.
                <br />첫 번째 원두를 추가해 보세요.
            </div>
            <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-4 py-2 rounded-lg bg-surface dark:bg-surface-elevated cursor-pointer hover:bg-surface-raised transition-colors"
            >
                <Plus size={14} strokeWidth={2} />
                생두 추가
            </button>
        </div>
    );

    const leftPanel = (
        <div className="flex flex-col gap-2">
            <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-[#E5E5E5] dark:border-[#585d61] bg-transparent text-sm text-muted cursor-pointer hover:text-secondary hover:border-black/15 transition-colors tracking-[0.14px]"
            >
                <Plus size={14} strokeWidth={2} />
                Add Bean
            </button>
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
            onEdit={(bean) => openModal('edit', bean.id, bean)}
            onRestock={(id) => openModal('restock', id)}
            onStartRoast={() => {
                if (selected?.id) useRoastingStore.getState().setPendingBean(selected.id);
                onNavigate?.('roast');
            }}
            onDelete={(id) => {
                deleteBean(id, { onSuccess: () => setSelectedId(null) });
            }}
        />
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
                title="Bean Inventory"
                actions={
                    <PillButton onClick={() => setIsAddModalOpen(true)}>
                        <Plus size={15} strokeWidth={2.5} />
                        Add Bean Lot
                    </PillButton>
                }
            />

            <div className="flex border-b border-(--color-border) dark:border-[#585d61] mb-4">
                <button
                    className={`px-4 py-2 text-sm font-medium cursor-pointer ${tab === 'single' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'text-(--color-muted)'}`}
                    onClick={() => setTab('single')}
                >
                    싱글
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium cursor-pointer ${tab === 'blend' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'text-(--color-muted)'}`}
                    onClick={() => setTab('blend')}
                >
                    블렌드
                </button>
            </div>

            {tab === 'single' &&
                (!isLoading && beans.length === 0 ? (
                    emptyState
                ) : (
                    <MasterDetailLayout left={leftPanel} detail={detailPanel} />
                ))}

            {tab === 'blend' && <BlendList />}
        </PageLayout>
    );
};
