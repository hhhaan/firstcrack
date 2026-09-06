import type { BlendWithComponents } from '@entities/blend';
import { BlendCompositionBar, coloredSegmentsFromSources } from '@entities/blend';
import { blendSegmentsFromComponents, blendTotalRatio } from '@entities/blend/lib';
import { useTranslation } from 'react-i18next';

export type BlendCardProps = {
    blend: BlendWithComponents;
    roastableKg: number;
    onSelect: () => void;
};

export const BlendCard = ({ blend, roastableKg, onSelect }: BlendCardProps) => {
    const { t } = useTranslation();
    const components = blend.blend_components;
    const total = blendTotalRatio(components);
    const segments = coloredSegmentsFromSources(blendSegmentsFromComponents(components));

    return (
        <div
            onClick={onSelect}
            className="rounded-lg bg-main-bg px-4 py-3.5 cursor-pointer transition-all duration-150 dark:border dark:border-[#585d61]"
        >
            <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[13px] font-medium text-primary tracking-[0.14px] leading-snug">
                    {blend.name}
                </span>
                {roastableKg > 0 ? (
                    <span className="text-[12px] font-mono text-secondary shrink-0 tracking-[0.14px]">
                        {t('beans.blend.roastableKg', { kg: roastableKg.toFixed(2) })}
                    </span>
                ) : (
                    <span className="text-[11px] font-medium text-palette-violet shrink-0 tracking-[0.14px]">
                        {t('beans.blend.noStock')}
                    </span>
                )}
            </div>

            <p className="text-[12px] text-muted tracking-[0.14px] mb-2 line-clamp-1">
                {t('beans.blend.summary', { count: components.length, total })}
                {blend.description ? ` · ${blend.description}` : ''}
            </p>

            <BlendCompositionBar segments={segments} showLegend />
        </div>
    );
};
