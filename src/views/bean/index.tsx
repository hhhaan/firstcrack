import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@shared/store/auth';
import { useBeans, useDeleteBean } from '@entities/bean/queries';
import { BeanList } from '@widgets/bean-list/ui/BeanList';
import { BeanDetail } from '@widgets/bean-detail/ui/BeanDetail';
import { AddBeanModal } from '@widgets/add-bean-modal/ui/AddBeanModal';
import { PageLayout } from '@shared/ui/PageLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { PillButton } from '@shared/ui/PillButton';
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

            <PageHeader
                title="Bean Inventory"
                actions={
                    <PillButton onClick={() => setIsAddModalOpen(true)}>
                        <Plus size={15} strokeWidth={2.5} />
                        Add Bean Lot
                    </PillButton>
                }
            />

            <div className="flex border-b border-(--color-border) mb-4">
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

            {tab === 'single' && (
                <>
                    {!isLoading && beans.length === 0 ? (
                        <div className="bg-main-bg rounded-xl px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
                            {/* <Coffee size={40} strokeWidth={1.5} className="text-muted" /> */}
                            <div className="text-[13px] text-muted text-center leading-relaxed">
                                등록된 원두가 없습니다.
                                <br />첫 번째 원두를 추가해 보세요.
                            </div>
                            <button
                                onClick={() => setIsAddModalOpen(true)}
                                className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-4 py-2 rounded-lg bg-surface cursor-pointer hover:bg-surface-raised transition-colors"
                            >
                                <Plus size={14} strokeWidth={2} />
                                생두 추가
                            </button>
                        </div>
                    ) : (
                        <div className="grid gap-5" style={{ gridTemplateColumns: '350px 1fr' }}>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => setIsAddModalOpen(true)}
                                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-[#E5E5E5] bg-transparent text-sm text-muted cursor-pointer hover:text-secondary hover:border-black/15 transition-colors tracking-[0.14px]"
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
                                />
                            </div>
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
                </>
            )}

            {tab === 'blend' && <BlendList />}
        </PageLayout>
    );
};
