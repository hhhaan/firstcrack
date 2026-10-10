import type { StockSummary } from '@entities/bean-stock-event';
import type { BlendWithComponents } from '@entities/blend';
import type { Bean, RoastProfile } from '@shared/types/database.types';
import { labelCls } from '@shared/ui/form-styles';
import { AlertTriangle, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BatchType } from '../lib/types';
import { SearchableSelect } from './SearchableSelect';
import type { BatchStockChecks } from './useBatchStockChecks';

type Props = {
    batchType: BatchType;
    profileId: string;
    beanId: string;
    blendId: string | null;
    profileItems: RoastProfile[];
    beanItems: Bean[];
    blends: BlendWithComponents[];
    stockSummaries: Record<string, StockSummary>;
    plannedGrams: number;
    stockSummaryEffectiveGrams?: number;
    stockChecks: Pick<BatchStockChecks, 'isShortage' | 'blendShortages'>;
    onProfileSelect: (id: string) => void;
    onBeanSelect: (id: string) => void;
    onBlendSelect: (id: string | null) => void;
};

export const BatchSourceFields = ({
    batchType,
    profileId,
    beanId,
    blendId,
    profileItems,
    beanItems,
    blends,
    stockSummaries,
    plannedGrams,
    stockSummaryEffectiveGrams,
    stockChecks,
    onProfileSelect,
    onBeanSelect,
    onBlendSelect,
}: Props) => {
    const { t } = useTranslation();
    const { isShortage, blendShortages } = stockChecks;

    return (
        <div className="grid grid-cols-2 gap-4">
            <div>
                <label className={labelCls}>{t('addBatchModal.roastProfile')}</label>
                <SearchableSelect
                    placeholder={t('addBatchModal.profilePlaceholder')}
                    items={profileItems}
                    selectedId={profileId}
                    onSelect={onProfileSelect}
                    renderLabel={(item) => (item as RoastProfile).name}
                    renderOption={(item) => {
                        const p = item as RoastProfile;
                        return (
                            <div>
                                <div className="text-primary font-medium">{p.name}</div>
                                <div className="text-[11px] text-muted mt-0.5">{p.target_level}</div>
                            </div>
                        );
                    }}
                />
            </div>
            <div>
                {batchType === 'Single Origin' ? (
                    <>
                        <label className={labelCls}>
                            <Package size={12} /> Green Coffee Lot
                        </label>
                        <SearchableSelect
                            placeholder={t('addBatchModal.lotPlaceholder')}
                            items={beanItems}
                            selectedId={beanId}
                            onSelect={onBeanSelect}
                            renderLabel={(item) => (item as Bean).name}
                            renderOption={(item) => {
                                const b = item as Bean;
                                const summary = stockSummaries[b.id];
                                return (
                                    <div>
                                        <div className="text-primary font-medium">{b.name}</div>
                                        <div className="text-[11px] text-muted mt-0.5">
                                            {summary &&
                                                t('addBatchModal.stock', {
                                                    kg: (summary.effectiveGrams / 1000).toFixed(1),
                                                })}
                                            {b.origin && `${summary ? ' · ' : ''}${b.origin}`}
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        {isShortage && stockSummaryEffectiveGrams != null && (
                            <p className="text-xs text-red-500 mt-1">
                                {t('addBatchModal.shortage', {
                                    effective: stockSummaryEffectiveGrams,
                                    needed: plannedGrams,
                                })}
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <label className={labelCls}>
                            <Package size={12} /> {t('addBatchModal.blend')}
                        </label>
                        <SearchableSelect
                            placeholder={t('addBatchModal.blendPlaceholder')}
                            items={blends}
                            selectedId={blendId ?? ''}
                            onSelect={(id) => onBlendSelect(id || null)}
                            renderLabel={(item) => (item as BlendWithComponents).name}
                            renderOption={(item) => {
                                const b = item as BlendWithComponents;
                                const compCount = b.blend_components?.length ?? 0;
                                return (
                                    <div>
                                        <div className="text-primary font-medium">{b.name}</div>
                                        <div className="text-[11px] text-muted mt-0.5">
                                            {b.description ?? t('addBatchModal.blendComposition', { count: compCount })}
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        {blendShortages.length > 0 && blendShortages.some((s) => s.isShort) && (
                            <div className="mt-2 space-y-1">
                                {blendShortages
                                    .filter((s) => s.isShort)
                                    .map((s) => (
                                        <p key={s.beanName} className="text-xs text-red-500 flex items-start gap-1">
                                            <AlertTriangle size={11} strokeWidth={2} className="shrink-0 mt-0.5" />
                                            <span>
                                                {t('addBatchModal.blendShortage', {
                                                    name: s.beanName,
                                                    effective: s.effectiveGrams,
                                                    needed: s.neededGrams,
                                                })}
                                            </span>
                                        </p>
                                    ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
