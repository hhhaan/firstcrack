import type { BlendWithComponents } from '@entities/blend';
import { blendSegmentsFromComponents, blendTotalRatio } from '@entities/blend/lib';
import type { BlendRoastableResult } from '@shared/lib/blend-stock';
import { coloredSegmentsFromSources } from '@widgets/blend-list/ui/BlendCompositionBar';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type BlendDetailProps = {
    blend: BlendWithComponents | null;
    roastable: BlendRoastableResult;
    onEdit: (blend: BlendWithComponents) => void;
    onDelete: (id: string) => void;
};

export const BlendDetail = ({ blend, roastable, onEdit, onDelete }: BlendDetailProps) => {
    const { t } = useTranslation();

    if (!blend) return null;

    const components = blend.blend_components;
    const total = blendTotalRatio(components);
    const segments = coloredSegmentsFromSources(blendSegmentsFromComponents(components));

    return (
        <div className="bg-main-bg rounded-lg px-8 py-7 h-fit dark:border dark:border-[#585d61]">
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h2 className="font-display font-light text-[26px] leading-[1.2] text-primary tracking-[-0.3px] mb-1">
                        {blend.name}
                    </h2>
                    {blend.description && (
                        <p className="text-sm text-secondary tracking-[0.14px] leading-normal">{blend.description}</p>
                    )}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => onEdit(blend)}
                        className="w-9 h-9 rounded-[10px] border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer"
                        title={t('beans.blend.edit')}
                    >
                        <Pencil size={14} strokeWidth={2} />
                    </button>
                    <button
                        onClick={() => onDelete(blend.id)}
                        className="w-9 h-9 rounded-[10px] border-none bg-surface dark:bg-surface-elevated flex items-center justify-center cursor-pointer text-red-600"
                        title={t('beans.blend.delete')}
                    >
                        <Trash2 size={14} strokeWidth={2} />
                    </button>
                </div>
            </div>

            <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4.5 py-4 mb-6">
                <div className="text-[12px] font-semibold text-secondary mb-3 tracking-[0.14px]">
                    {t('beans.blend.componentBeans')}
                </div>
                <div className="space-y-2.5">
                    {components.map((c, i) => (
                        <div key={c.id}>
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                    {c.beans.name}
                                </span>
                                <span className="text-[12px] font-mono font-semibold text-secondary">
                                    {c.ratio_pct}%
                                </span>
                            </div>
                            <div className="h-1.5 bg-white/70 dark:bg-white/8 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${total > 0 ? (Number(c.ratio_pct) / total) * 100 : 0}%`,
                                        backgroundColor: segments[i]?.color,
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4.5 py-4 mb-6">
                <div className="text-[12px] font-semibold text-secondary mb-2 tracking-[0.14px]">
                    {t('beans.blend.roastableCapacity')}
                </div>
                {roastable.maxGrams > 0 ? (
                    <>
                        <div className="font-display font-light text-[22px] leading-[1.2] text-primary tracking-[-0.3px] mb-1">
                            {t('beans.blend.roastableKg', { kg: (roastable.maxGrams / 1000).toFixed(2) })}
                        </div>
                        {roastable.limitingBeanName && (
                            <p className="text-[12px] text-muted tracking-[0.14px]">
                                {t('beans.blend.limitingBean', {
                                    name: roastable.limitingBeanName,
                                    grams: roastable.limitingEffectiveGrams,
                                })}
                            </p>
                        )}
                    </>
                ) : (
                    <p className="text-[13px] text-red-600 dark:text-red-400 tracking-[0.14px]">
                        {t('beans.blend.noStock')}
                    </p>
                )}
            </div>

            <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-surface-warm-solid dark:bg-[#222] dark:border dark:border-[#35383d]">
                <span className="text-[12px] text-muted tracking-[0.14px]">
                    {t('beans.blend.summary', { count: components.length, total })}
                </span>
            </div>
        </div>
    );
};
