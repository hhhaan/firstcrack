import type { StockSummary } from '@entities/bean-stock-event';
import type { BlendWithComponents } from '@entities/blend';
import { blendSegmentsFromComponents, blendTotalRatio } from '@entities/blend/lib';
import type { BlendRoastableResult } from '@shared/lib/blend-stock';
import { Badge } from '@shared/ui/Badge';
import { BlendCompositionBar, coloredSegmentsFromSources } from '@widgets/blend-list/ui/BlendCompositionBar';
import { Edit3, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeleteBlendModal } from './DeleteBlendModal';

export type BlendDetailProps = {
    blend: BlendWithComponents | null;
    roastable: BlendRoastableResult;
    stockSummaries?: Record<string, StockSummary>;
    onEdit: (blend: BlendWithComponents) => void;
    onDelete: (id: string) => void;
};

export const BlendDetail = ({ blend, roastable, stockSummaries = {}, onEdit, onDelete }: BlendDetailProps) => {
    const { t } = useTranslation();
    const [confirmId, setConfirmId] = useState<string | null>(null);

    if (!blend) return null;

    const components = blend.blend_components;
    const total = blendTotalRatio(components);
    const segments = coloredSegmentsFromSources(blendSegmentsFromComponents(components));
    const roastableKg = (roastable.maxGrams / 1000).toFixed(2);

    const meta = [
        {
            label: t('beans.blend.componentBeans'),
            value: t('beans.blend.componentCount', { count: components.length }),
        },
        {
            label: t('beans.blend.totalRatioLabel'),
            value: `${total}%`,
        },
        {
            label: t('beans.blend.roastableCapacity'),
            value:
                roastable.maxGrams > 0 ? t('beans.blend.roastableKg', { kg: roastableKg }) : t('beans.blend.noStock'),
        },
        {
            label: t('beans.blend.limitingBeanLabel'),
            value: roastable.limitingBeanName
                ? `${roastable.limitingBeanName} (${roastable.limitingEffectiveGrams}g)`
                : '—',
        },
    ];

    return (
        <div className="bg-main-bg rounded-2xl border border-border px-8 py-7 h-fit relative">
            <DeleteBlendModal
                open={confirmId === blend.id}
                blendName={blend.name}
                onClose={() => setConfirmId(null)}
                onConfirm={() => {
                    const id = blend.id;
                    setConfirmId(null);
                    onDelete(id);
                }}
            />
            <div className="absolute top-6 right-6 flex gap-2 z-2">
                <button
                    type="button"
                    onClick={() => onEdit(blend)}
                    className="w-9 h-9 rounded-[10px] border border-black/6 dark:border-border bg-white dark:bg-surface-elevated text-muted dark:text-primary flex items-center justify-center cursor-pointer transition-[color,background-color,box-shadow,opacity] duration-200"
                    title={t('beans.blend.edit')}
                >
                    <Edit3 size={16} />
                </button>
                <button
                    type="button"
                    onClick={() => setConfirmId(blend.id)}
                    className="w-9 h-9 rounded-[10px] border border-black/6 dark:border-border bg-white dark:bg-surface-elevated flex items-center justify-center cursor-pointer transition-[color,background-color,box-shadow,opacity] duration-200 text-red-600 dark:text-red-400"
                    title={t('beans.blend.delete')}
                >
                    <Trash2 size={16} />
                </button>
            </div>

            <div className="mb-6 pr-10">
                <h2 className="font-(--font-display) text-[26px] leading-[1.2] text-primary tracking-[0.24px] mb-1">
                    {blend.name}
                </h2>
                <div className="flex gap-1.5 flex-wrap">
                    <Badge tone="neutral" className="text-xs px-2.25">
                        {t('beans.blend.componentCount', { count: components.length })}
                    </Badge>
                    <Badge tone="soft" className="text-xs px-2.25">
                        {total}%
                    </Badge>
                    {roastable.maxGrams > 0 ? (
                        <Badge tone="good" className="text-xs px-2.25">
                            {t('beans.blend.roastableKg', { kg: roastableKg })}
                        </Badge>
                    ) : (
                        <Badge tone="bad" className="text-xs px-2.25">
                            {t('beans.blend.noStock')}
                        </Badge>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
                {meta.map(({ label, value }) => (
                    <div key={label}>
                        <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-0.75">
                            {label}
                        </div>
                        <div className="text-sm font-medium text-primary tracking-[0.14px]">{value}</div>
                    </div>
                ))}
            </div>

            {blend.description && (
                <div className="bg-surface-warm-solid rounded-lg px-4 py-3.5 mb-6">
                    <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                        {t('beans.blend.description')}
                    </div>
                    <p className="text-sm text-primary tracking-[0.14px] leading-relaxed">{blend.description}</p>
                </div>
            )}

            <div className="mb-6">
                <div className="flex justify-between mb-1.5">
                    <span className="text-xs font-medium text-secondary tracking-[0.14px]">
                        {t('beans.blend.composition')}
                    </span>
                    <span className="text-xs text-muted font-mono">{total}%</span>
                </div>
                <BlendCompositionBar segments={segments} height="md" />
            </div>

            <div className="space-y-3">
                {components.map((c, i) => {
                    const effectiveGrams = stockSummaries[c.bean_id]?.effectiveGrams ?? 0;
                    return (
                        <div key={c.id} className="flex items-start gap-3">
                            <span
                                className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: segments[i]?.color }}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-primary tracking-[0.14px] truncate">
                                        {c.beans.name}
                                    </span>
                                    <span className="text-xs font-mono text-secondary shrink-0">{c.ratio_pct}%</span>
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px] mt-0.5">
                                    {t('beans.blend.effectiveStock', {
                                        kg: (effectiveGrams / 1000).toFixed(2),
                                    })}
                                </div>
                                <div className="h-1 bg-surface rounded-full overflow-hidden mt-1.5">
                                    <div
                                        className="h-full rounded-full transition-[color,background-color,box-shadow,opacity] duration-500"
                                        style={{
                                            width: `${total > 0 ? (Number(c.ratio_pct) / total) * 100 : 0}%`,
                                            backgroundColor: segments[i]?.color,
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
