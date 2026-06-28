import { MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { AddBlendModal } from '@widgets/add-blend-modal';
import { BlendDetail } from '@widgets/blend-detail/ui/BlendDetail';
import { useBlendListState } from '@widgets/blend-list/model/useBlendListState';
import { BlendCard } from '@widgets/blend-list/ui/BlendCard';
import { BlendListEmpty } from '@widgets/blend-list/ui/BlendListEmpty';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const BlendList = () => {
    const { t } = useTranslation();
    const {
        blends,
        isLoading,
        selected,
        setSelectedId,
        modalOpen,
        editing,
        roastableByBlendId,
        roastable,
        openCreate,
        openEdit,
        closeModal,
        handleDelete,
    } = useBlendListState();

    const leftPanel = (
        <div className="flex flex-col gap-2">
            <button
                onClick={openCreate}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-[#E5E5E5] dark:border-[#585d61] bg-transparent text-sm text-muted cursor-pointer hover:text-secondary hover:border-black/15 dark:hover:border-[#585d61] transition-colors tracking-[0.14px] mb-1"
            >
                <Plus size={14} strokeWidth={2} />
                {t('beans.blend.addBlend')}
            </button>

            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted dark:text-[#e5e5e5]">
                    {t('beans.loading')}
                </div>
            ) : (
                blends.map((blend) => (
                    <BlendCard
                        key={blend.id}
                        blend={blend}
                        roastableKg={(roastableByBlendId[blend.id]?.maxGrams ?? 0) / 1000}
                        onSelect={() => setSelectedId(blend.id)}
                    />
                ))
            )}
        </div>
    );

    return (
        <>
            {!isLoading && blends.length === 0 ? (
                <BlendListEmpty onAdd={openCreate} />
            ) : (
                <MasterDetailLayout
                    left={leftPanel}
                    detail={
                        selected ? (
                            <BlendDetail
                                blend={selected}
                                roastable={roastable}
                                onEdit={openEdit}
                                onDelete={handleDelete}
                            />
                        ) : null
                    }
                    placeholder={t('beans.blend.selectBlend')}
                />
            )}

            <AddBlendModal key={editing?.id ?? 'new'} open={modalOpen} onClose={closeModal} editing={editing} />
        </>
    );
};
