import type { Bean } from '@shared/types/database.types';
import { BlendCompositionBar, coloredSegmentsFromSources } from '@widgets/blend-list/ui/BlendCompositionBar';
import { AlertTriangle, ChevronDown, Plus, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPctValue, inputCls, labelCls, normalizePct, parseNumericInput, parsePctInput } from '../lib/format';
import type { BlendComponentCost, BlendSourceMode, SourceMode } from '../lib/types';
import { BeanCombobox } from './BeanCombobox';
import { PricingSection } from './PricingSection';

type BlendOption = { id: string; name: string };

type SourcePanelProps = {
    mode: SourceMode;
    onModeChange: (mode: SourceMode) => void;
    beans: Bean[];
    blends: BlendOption[];
    selectedBeanId: string | null;
    onBeanSelect: (beanId: string) => void;
    greenCostPerKg: number;
    onGreenCostChange: (value: number) => void;
    missingBeanCost: boolean;
    onGoToBeans: () => void;
    blendSource: BlendSourceMode;
    onBlendSourceChange: (mode: BlendSourceMode) => void;
    selectedBlendId: string | null;
    onBlendSelect: (blendId: string) => void;
    blendComponents: BlendComponentCost[];
    onBlendComponentChange: (id: string, patch: Partial<BlendComponentCost>) => void;
    onBlendComponentBeanSelect: (id: string, beanId: string) => void;
    onAddBlendRow: () => void;
    onRemoveBlendRow: (id: string) => void;
};

const segmentedBtn = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-[13px] font-medium tracking-[0.14px] cursor-pointer transition-colors ${
        active ? 'bg-main-bg text-primary shadow-(--shadow-inset)' : 'text-muted hover:text-secondary bg-transparent'
    }`;

const subSegmentedBtn = (active: boolean) =>
    `px-3 py-1 rounded-full text-[12px] font-medium tracking-[0.14px] cursor-pointer transition-colors ${
        active ? 'bg-surface-warm-solid text-primary' : 'text-muted hover:text-secondary bg-transparent'
    }`;

export const SourcePanel = ({
    mode,
    onModeChange,
    beans,
    blends,
    selectedBeanId,
    onBeanSelect,
    greenCostPerKg,
    onGreenCostChange,
    missingBeanCost,
    onGoToBeans,
    blendSource,
    onBlendSourceChange,
    selectedBlendId,
    onBlendSelect,
    blendComponents,
    onBlendComponentChange,
    onBlendComponentBeanSelect,
    onAddBlendRow,
    onRemoveBlendRow,
}: SourcePanelProps) => {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;

    const compositionSegments = useMemo(
        () =>
            coloredSegmentsFromSources(
                blendComponents
                    .filter((c) => c.beanId && c.ratioPct > 0)
                    .map((c) => ({ ratioPct: c.ratioPct, label: c.name || c.beanId, id: c.id })),
            ),
        [blendComponents],
    );

    const ratioSum = useMemo(
        () => blendComponents.reduce((sum, c) => sum + (c.ratioPct > 0 ? c.ratioPct : 0), 0),
        [blendComponents],
    );
    const ratioOff = mode === 'blend' && ratioSum > 0 && Math.abs(ratioSum - 100) > 0.5;
    const ratioSumDisplay = normalizePct(ratioSum, lang);
    const beanOptions = useMemo(() => beans.map((b) => ({ id: b.id, name: b.name })), [beans]);

    return (
        <PricingSection step="01" title={t('pricing.source.title')}>
            <div className="inline-flex p-1 rounded-full bg-surface dark:bg-surface-elevated mb-6">
                {(['single', 'blend'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => onModeChange(m)} className={segmentedBtn(mode === m)}>
                        {t(`pricing.source.mode.${m}`)}
                    </button>
                ))}
            </div>

            {mode === 'single' ? (
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls} htmlFor="pricing-bean-select">
                            {t('pricing.source.bean')}
                        </label>
                        <BeanCombobox
                            id="pricing-bean-select"
                            items={beanOptions}
                            selectedId={selectedBeanId ?? ''}
                            onSelect={onBeanSelect}
                            placeholder={t('pricing.source.selectBean')}
                            emptyLabel={t('pricing.source.emptyBeans')}
                        />
                        {beans.length === 0 && (
                            <p className="mt-2 text-[12px] text-muted tracking-[0.14px]">
                                {t('pricing.source.emptyBeans')}
                            </p>
                        )}
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="pricing-green-cost">
                            {t('pricing.source.greenCost')}
                        </label>
                        <input
                            id="pricing-green-cost"
                            type="text"
                            inputMode="numeric"
                            className={inputCls}
                            placeholder={t('pricing.source.greenCostPlaceholder')}
                            value={greenCostPerKg > 0 ? greenCostPerKg.toLocaleString() : ''}
                            onChange={(e) => onGreenCostChange(parseNumericInput(e.target.value))}
                        />
                    </div>
                    {missingBeanCost && (
                        <div className="col-span-2 flex items-center gap-2 text-[13px] text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-500/10 rounded-xl px-3 py-2.5">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{t('pricing.source.missingCost')}</span>
                            <button
                                type="button"
                                onClick={onGoToBeans}
                                className="underline cursor-pointer bg-transparent border-none text-inherit p-0 font-medium"
                            >
                                {t('pricing.source.goToBeans')}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="inline-flex p-0.5 rounded-full bg-surface/80 dark:bg-surface-elevated self-start">
                        {(['saved', 'custom'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => onBlendSourceChange(m)}
                                className={subSegmentedBtn(blendSource === m)}
                            >
                                {t(`pricing.source.blendSource.${m}`)}
                            </button>
                        ))}
                    </div>

                    {blendSource === 'saved' ? (
                        <div>
                            <label className={labelCls} htmlFor="pricing-blend-select">
                                {t('pricing.source.blend')}
                            </label>
                            <div className="relative max-w-md">
                                <select
                                    id="pricing-blend-select"
                                    value={selectedBlendId ?? ''}
                                    onChange={(e) => onBlendSelect(e.target.value)}
                                    className={`${inputCls} appearance-none cursor-pointer`}
                                    style={{ paddingRight: '2rem' }}
                                >
                                    <option value="">{t('pricing.source.selectBlend')}</option>
                                    {blends.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown
                                    size={16}
                                    strokeWidth={2}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                                />
                            </div>
                            {blends.length === 0 && (
                                <p className="mt-2 text-[12px] text-muted tracking-[0.14px]">
                                    {t('pricing.source.emptyBlends')}
                                </p>
                            )}
                            {compositionSegments.length > 0 && (
                                <div className="mt-3 max-w-md">
                                    <BlendCompositionBar segments={compositionSegments} height="md" showLegend />
                                </div>
                            )}
                        </div>
                    ) : null}

                    <div className="flex flex-col gap-1.5">
                        <span className={labelCls}>{t('pricing.source.components')}</span>
                        <div className="grid grid-cols-[1fr_4rem_6.5rem_2rem] gap-2 px-2 text-[10px] font-medium uppercase tracking-[0.5px] text-muted">
                            <span>{t('pricing.source.bean')}</span>
                            <span className="text-right">{t('pricing.source.ratioHeader')}</span>
                            <span className="text-right">{t('pricing.source.costShort')}</span>
                            <span />
                        </div>
                        {blendComponents.map((row, idx) => (
                            <div
                                key={row.id}
                                className={`grid grid-cols-[1fr_4rem_6.5rem_2rem] gap-2 items-center rounded-xl px-2 py-1.5 ${
                                    idx % 2 === 0 ? 'bg-surface/50 dark:bg-surface-elevated/40' : ''
                                }`}
                            >
                                <BeanCombobox
                                    items={beanOptions}
                                    selectedId={row.beanId}
                                    onSelect={(beanId) => onBlendComponentBeanSelect(row.id, beanId)}
                                    onFreeText={(name) =>
                                        onBlendComponentChange(row.id, {
                                            beanId: '',
                                            name,
                                        })
                                    }
                                    placeholder={t('pricing.source.selectBean')}
                                    disabled={blendSource === 'saved'}
                                    compact
                                />
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className={`${inputCls} text-right text-[13px] py-2`}
                                    placeholder="%"
                                    value={formatPctValue(row.ratioPct, lang)}
                                    onChange={(e) =>
                                        onBlendComponentChange(row.id, {
                                            ratioPct: parsePctInput(e.target.value, lang),
                                        })
                                    }
                                    disabled={blendSource === 'saved'}
                                />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    className={`${inputCls} text-right text-[13px] py-2`}
                                    placeholder={t('pricing.source.greenCostPlaceholder')}
                                    value={row.costPerKg ? row.costPerKg.toLocaleString() : ''}
                                    onChange={(e) =>
                                        onBlendComponentChange(row.id, {
                                            costPerKg: parseNumericInput(e.target.value) || null,
                                        })
                                    }
                                />
                                {blendSource === 'custom' && blendComponents.length > 1 ? (
                                    <button
                                        type="button"
                                        className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer hover:text-red-500"
                                        onClick={() => onRemoveBlendRow(row.id)}
                                    >
                                        <X size={14} strokeWidth={2.5} />
                                    </button>
                                ) : (
                                    <span />
                                )}
                            </div>
                        ))}
                        {blendSource === 'custom' && (
                            <button
                                type="button"
                                onClick={onAddBlendRow}
                                className="flex items-center gap-1.5 text-[13px] text-muted hover:text-secondary cursor-pointer bg-transparent border-none p-0 self-start mt-1"
                            >
                                <Plus size={14} />
                                {t('pricing.source.addComponent')}
                            </button>
                        )}
                        {ratioOff && (
                            <div className="flex items-center gap-2 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-500/10 rounded-xl px-3 py-2 mt-1">
                                <AlertTriangle size={13} className="shrink-0" />
                                <span>{t('pricing.source.ratioSum', { sum: ratioSumDisplay })}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </PricingSection>
    );
};
