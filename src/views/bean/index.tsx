import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@shared/store/auth';
import { useBeans, useDeleteBean } from '@entities/bean/queries';
import { BeanList } from '@widgets/bean-list/ui/BeanList';
import { BeanDetail } from '@widgets/bean-detail/ui/BeanDetail';
import { AddBeanModal } from '@widgets/add-bean-modal/ui/AddBeanModal';
import { PageLayout } from '@shared/ui/PageLayout';
import type { Bean } from '@shared/types/database.types';
import type { View } from '@shared/types/view';
import { useRoastingStore } from '@features/active-roast/model/status';
import { BlendList } from './BlendList';

export const Beans = ({ onNavigate }: { onNavigate?: (view: View) => void }) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: beans = [], isLoading } = useBeans(userId);
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

            {/* Header */}
            <div className="flex items-end justify-between mb-7">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        {/* {t('machines.title')} */}
                        Bean Inventory
                    </h1>
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px]"
                >
                    <Plus size={15} strokeWidth={2.5} />
                    Add Bean Lot
                </button>
            </div>

            <div className="flex border-b border-(--color-border) mb-4">
                <button
                    className={`px-4 py-2 text-sm font-medium ${tab === 'single' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'text-(--color-muted)'}`}
                    onClick={() => setTab('single')}
                >
                    싱글
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium ${tab === 'blend' ? 'border-b-2 border-(--color-primary) text-(--color-primary)' : 'text-(--color-muted)'}`}
                    onClick={() => setTab('blend')}
                >
                    블렌드
                </button>
            </div>

            {tab === 'single' && (
                <div className="grid gap-5" style={{ gridTemplateColumns: '350px 1fr' }}>
                    <BeanList
                        beans={beans}
                        isLoading={isLoading}
                        selectedId={selected?.id ?? null}
                        onSelect={setSelectedId}
                        search={search}
                        onSearchChange={setSearch}
                    />
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
                </div>
            )}

            {tab === 'blend' && <BlendList />}
        </PageLayout>
    );
};
