import type { BlendWithComponents } from '@entities/blend';
import { MasterDetail } from '@shared/ui/MasterDetailLayout';
import { BlendDetail } from '@widgets/blend-detail/ui/BlendDetail';
import { useBlendListState } from '@widgets/blend-list/model/useBlendListState';
import { BlendCard } from '@widgets/blend-list/ui/BlendCard';
import { BlendListEmpty } from '@widgets/blend-list/ui/BlendListEmpty';
import { useTranslation } from 'react-i18next';

interface BlendListProps {
    hasBeans: boolean;
    onAddOpen: () => void;
    onNeedBeans: () => void;
    onEditOpen: (blend: BlendWithComponents) => void;
}

export const BlendList = ({ hasBeans, onAddOpen, onNeedBeans, onEditOpen }: BlendListProps) => {
    const { t } = useTranslation();
    const { blends, isLoading, selected, setSelectedId, roastableByBlendId, roastable, stockSummaries, handleDelete } =
        useBlendListState();

    const leftPanel = (
        <div className="flex flex-col gap-2">
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
                <BlendListEmpty hasBeans={hasBeans} onAdd={onAddOpen} onNeedBeans={onNeedBeans} />
            ) : (
                <MasterDetail.Root>
                    <MasterDetail.Master>{leftPanel}</MasterDetail.Master>
                    {selected ? (
                        <MasterDetail.Detail>
                            <BlendDetail
                                blend={selected}
                                roastable={roastable}
                                stockSummaries={stockSummaries}
                                onEdit={onEditOpen}
                                onDelete={handleDelete}
                            />
                        </MasterDetail.Detail>
                    ) : (
                        <MasterDetail.Empty>{t('beans.blend.selectBlend')}</MasterDetail.Empty>
                    )}
                </MasterDetail.Root>
            )}
        </>
    );
};
