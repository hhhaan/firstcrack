import type { BlendWithComponents } from '@entities/blend';
import type { BlendRoastableResult } from '@shared/lib/blend-stock';
import { useTranslation } from 'react-i18next';
import { BlendCard } from './BlendCard';

interface BlendListProps {
    blends: BlendWithComponents[];
    isLoading: boolean;
    roastableByBlendId: Record<string, BlendRoastableResult>;
    onSelect: (id: string) => void;
}

export const BlendList = ({ blends, isLoading, roastableByBlendId, onSelect }: BlendListProps) => {
    const { t } = useTranslation();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted dark:text-[#e5e5e5]">
                {t('beans.loading')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {blends.map((blend) => (
                <BlendCard
                    key={blend.id}
                    blend={blend}
                    roastableKg={(roastableByBlendId[blend.id]?.maxGrams ?? 0) / 1000}
                    onSelect={() => onSelect(blend.id)}
                />
            ))}
        </div>
    );
};
