import {
    buildAutoName,
    COMMON_ORIGINS,
    COMMON_PROCESSES,
    FARMS_BY_REGION,
    REGIONS_BY_ORIGIN,
    VARIETIES_BY_ORIGIN,
} from '@entities/bean/lib/coffee-origins';
import type { StockSummary } from '@entities/bean-stock-event';
import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormEscape } from '@shared/lib/useFormEscape';
import type { Bean } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Check, Info, MapPin, Scale, Search, Tag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { type BeanForm, beanFormSchema, EMPTY_BEAN_FORM } from '../lib/schema';
import { useAddBeanSubmit } from './useAddBeanSubmit';

// ── 모듈 레벨 상수 ──────────────────────────────────────────

const NUMERIC_INPUT_PROPS = {
    type: 'text' as const,
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
} satisfies Partial<React.InputHTMLAttributes<HTMLInputElement>>;

const chipCls = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150 border ${
        selected
            ? 'border-primary bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61]'
            : 'border-black/10 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-secondary'
    }`;

const tabCls = (active: boolean) =>
    `flex-1 py-3 rounded-xl border-none text-sm cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white dark:bg-surface-elevated font-semibold text-primary dark:text-white shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted dark:text-white hover:text-secondary dark:hover:text-white/70'
    }`;

// ── 공통 입력 필드 ───────────────────────────────────────────

const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';
const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';

const ChipGroup = ({
    items,
    renderItem,
    limit = 5,
}: {
    items: readonly string[];
    renderItem: (item: string) => React.ReactNode;
    limit?: number;
}) => {
    const [expanded, setExpanded] = useState(false);
    const visible = !expanded && items.length > limit ? items.slice(0, limit) : items;
    const hiddenCount = items.length - limit;
    return (
        <>
            {visible.map(renderItem)}
            {!expanded && hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer border border-black/10 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-muted"
                >
                    +{hiddenCount}
                </button>
            )}
        </>
    );
};

// ──────────────────────────────────────────────────────────────

const BeanSelector = ({
    label,
    visibleBeans,
    selectedBeanId,
    showAllBeans,
    hiddenBeanCount,
    stockSummaries,
    onSelect,
    onShowAll,
}: {
    label: string;
    visibleBeans: Bean[];
    selectedBeanId: string | null;
    showAllBeans: boolean;
    hiddenBeanCount: number;
    stockSummaries: Record<string, StockSummary>;
    onSelect: (id: string) => void;
    onShowAll: () => void;
}) => (
    <div>
        <label className={labelCls}>
            <Search size={14} /> {label}
        </label>
        <div className="grid gap-2.5 p-1">
            {visibleBeans.map((bean) => {
                const isSelected = selectedBeanId === bean.id;
                return (
                    <div
                        key={bean.id}
                        onClick={() => onSelect(bean.id)}
                        className={`px-4.5 py-3.5 rounded-2xl border border-black/6 dark:border-[#585d61] flex items-center justify-between cursor-pointer transition-all duration-200 ${
                            isSelected
                                ? 'bg-primary dark:bg-black dark:border-white text-white shadow-[0_8px_20px_rgba(0,0,0,0.12)]'
                                : 'bg-white/70 dark:bg-surface-elevated text-primary shadow-(--shadow-ring)'
                        }`}
                    >
                        <div>
                            <div className="text-sm font-semibold">{bean.name}</div>
                            <div className="text-xs opacity-70">
                                {bean.origin ?? '—'} · {bean.process ?? '—'}
                            </div>
                        </div>
                        {isSelected ? (
                            <Check size={18} strokeWidth={2.5} />
                        ) : (
                            <div className="text-[13px] font-mono opacity-60">
                                {((stockSummaries[bean.id]?.currentGrams ?? 0) / 1000).toFixed(2)}
                                kg
                            </div>
                        )}
                    </div>
                );
            })}
            {!showAllBeans && hiddenBeanCount > 0 && (
                <button
                    type="button"
                    onClick={onShowAll}
                    className="py-2.5 rounded-2xl border border-black/6 dark:border-[#585d61] bg-white/50 dark:bg-surface-elevated text-sm font-medium text-muted cursor-pointer hover:bg-white/80 dark:hover:bg-[#262b31] transition-all duration-200"
                >
                    +{hiddenBeanCount} more
                </button>
            )}
        </div>
    </div>
);

// ──────────────────────────────────────────────────────────────

interface AddBeanModalProps {
    open: boolean;
    onClose: () => void;
    userId: string;
    existingBeans: Bean[];
    initialTab?: 'new' | 'restock' | 'expected' | 'edit' | 'adjust';
    initialBeanId?: string | null;
    initialData?: Bean | null;
    onSuccess?: (bean: Bean | null) => void;
}

export const AddBeanModal = ({
    open,
    onClose,
    userId,
    existingBeans,
    initialTab = 'new',
    initialBeanId = null,
    initialData = null,
    onSuccess,
}: AddBeanModalProps) => {
    const [tab, setTab] = useState<'new' | 'restock' | 'expected' | 'edit' | 'adjust'>(initialTab);
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(initialBeanId);
    const [restockAmount, setRestockAmount] = useState('');
    const [expectedAmount, setExpectedAmount] = useState('');
    const [expectedNote, setExpectedNote] = useState('');
    const [adjustType, setAdjustType] = useState<'adjustment' | 'write_off'>('adjustment');
    const [adjustSign, setAdjustSign] = useState<'+' | '-'>('+');
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustNote, setAdjustNote] = useState('');
    const [nameIsAuto, setNameIsAuto] = useState(true);
    const [showAllBeans, setShowAllBeans] = useState(false);

    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);

    const {
        register,
        handleSubmit: rhfSubmit,
        setValue,
        watch,
        reset,
        getValues,
        formState: { errors },
    } = useForm<BeanForm>({
        resolver: zodResolver(beanFormSchema),
        defaultValues: EMPTY_BEAN_FORM,
    });

    const formValues = watch();

    const { handleSubmit: submitBean, isSubmitting } = useAddBeanSubmit({
        userId,
        tab,
        selectedBeanId,
        restockAmount,
        expectedAmount,
        expectedNote,
        adjustType,
        adjustSign,
        adjustAmount,
        adjustNote,
        existingBeans,
        initialData: initialData ?? null,
        onSuccess,
        onClose,
    });

    useFormEscape(open, onClose);

    // Reset form when opening or switching mode
    useEffect(() => {
        if (!open) return;
        setTab(initialTab);
        setSelectedBeanId(initialBeanId);
        setRestockAmount('');
        setExpectedAmount('');
        setExpectedNote('');
        setAdjustType('adjustment');
        setAdjustSign('+');
        setAdjustAmount('');
        setAdjustNote('');
        setShowAllBeans(false);
        const hasData = initialData && (initialTab === 'edit' || initialTab === 'new');
        setNameIsAuto(!hasData);
        if (hasData) {
            reset({
                name: initialData.name ?? '',
                origin: initialData.origin ?? '',
                region: initialData.region ?? '',
                farm: initialData.farm ?? '',
                process: initialData.process ?? 'Washed',
                variety: initialData.variety ?? '',
                altitude: initialData.altitude_masl?.toString() ?? '',
                stock: initialData?.id ? ((stockSummaries[initialData.id]?.effectiveGrams ?? 0) / 1000).toString() : '',
                capacity: initialData.capacity_grams ? (initialData.capacity_grams / 1000).toString() : '5',
                costPerKg: initialData.cost_per_kg?.toString() ?? '',
                tastingNotes: initialData.tasting_notes ?? '',
            });
        } else {
            reset(EMPTY_BEAN_FORM);
        }
    }, [open, initialTab, initialBeanId, initialData, reset, stockSummaries]);

    const handleNumericBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
        const ev = e.nativeEvent as InputEvent;
        if (ev.data && !/^\d*$/.test(ev.data)) e.preventDefault();
    };

    const handleNumericPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        if (!/^\d+$/.test(e.clipboardData.getData('text/plain'))) e.preventDefault();
    };

    const numericProps = {
        ...NUMERIC_INPUT_PROPS,
        onBeforeInput: handleNumericBeforeInput,
        onPaste: handleNumericPaste,
    };

    const restockGrams = Math.round((parseFloat(restockAmount) || 0) * 1000);
    const expectedGrams = Math.round((parseFloat(expectedAmount) || 0) * 1000);
    const adjustGrams = Math.round((parseFloat(adjustAmount) || 0) * 1000);
    const isSubmitDisabled =
        isSubmitting ||
        (tab === 'restock' && (!selectedBeanId || restockGrams <= 0)) ||
        (tab === 'expected' && (!selectedBeanId || expectedGrams <= 0)) ||
        (tab === 'adjust' && (!selectedBeanId || adjustGrams <= 0));

    const BEAN_LIMIT = 4;
    const visibleBeans = showAllBeans ? existingBeans : existingBeans.slice(0, BEAN_LIMIT);
    const hiddenBeanCount = existingBeans.length - BEAN_LIMIT;

    const updateOrigin = (origin: string) => {
        const newOrigin = formValues.origin === origin ? '' : origin;
        setValue('origin', newOrigin);
        setValue('region', '');
        setValue('farm', '');
        setValue('variety', '');
        if (nameIsAuto) {
            setValue('name', buildAutoName(newOrigin, '', '', ''));
        }
    };

    const updateRegion = (region: string) => {
        const newRegion = formValues.region === region ? '' : region;
        setValue('region', newRegion);
        setValue('farm', '');
        if (nameIsAuto) {
            setValue('name', buildAutoName(formValues.origin, newRegion, '', formValues.variety));
        }
    };

    const updateFarm = (farm: string) => {
        const newFarm = formValues.farm === farm ? '' : farm;
        setValue('farm', newFarm);
        if (nameIsAuto) {
            setValue('name', buildAutoName(formValues.origin, formValues.region, newFarm, formValues.variety));
        }
    };

    const updateVariety = (variety: string) => {
        const newVariety = formValues.variety === variety ? '' : variety;
        setValue('variety', newVariety);
        if (nameIsAuto) {
            setValue('name', buildAutoName(formValues.origin, formValues.region, formValues.farm, newVariety));
        }
    };

    const updateProcess = (process: string) => {
        setValue('process', formValues.process === process ? '' : process);
    };

    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="add-bean-modal-title"
            contentClassName="max-w-[640px] w-full max-h-[min(860px,calc(100vh-64px))] flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.97)] dark:bg-[#181d21] dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white dark:border-[#585d61] overflow-hidden"
        >
            {/* Header */}
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <h2
                            id="add-bean-modal-title"
                            className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                        >
                            {tab === 'new'
                                ? 'New Bean Lot'
                                : tab === 'edit'
                                  ? 'Edit Bean Details'
                                  : tab === 'restock'
                                    ? 'Restock Existing'
                                    : tab === 'expected'
                                      ? 'Expected Inbound'
                                      : 'Adjust Stock'}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-primary"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>

                {tab !== 'edit' && (
                    <div className="px-8 pb-5">
                        <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                            <button onClick={() => setTab('new')} className={tabCls(tab === 'new')}>
                                New Lot
                            </button>
                            <button onClick={() => setTab('restock')} className={tabCls(tab === 'restock')}>
                                Restock
                            </button>
                            <button onClick={() => setTab('expected')} className={tabCls(tab === 'expected')}>
                                Expected
                            </button>
                            <button onClick={() => setTab('adjust')} className={tabCls(tab === 'adjust')}>
                                Adjust
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable Body */}
            <div className="p-8 overflow-y-auto flex-1">
                {tab === 'adjust' ? (
                    <div className="flex flex-col gap-6">
                        {/* Bean selector */}
                        <BeanSelector
                            label="Select Bean"
                            visibleBeans={visibleBeans}
                            selectedBeanId={selectedBeanId}
                            showAllBeans={showAllBeans}
                            hiddenBeanCount={hiddenBeanCount}
                            stockSummaries={stockSummaries}
                            onSelect={setSelectedBeanId}
                            onShowAll={() => setShowAllBeans(true)}
                        />

                        {/* Operation type + amount */}
                        <div
                            className="p-6 rounded-[20px] flex flex-col gap-4 transition-opacity duration-200"
                            style={{
                                background: 'var(--color-surface-warm-solid)',
                                boxShadow: 'var(--shadow-warm)',
                                opacity: selectedBeanId ? 1 : 0.5,
                                pointerEvents: selectedBeanId ? 'auto' : 'none',
                            }}
                        >
                            {/* Type toggle */}
                            <div className="flex bg-surface p-1 rounded-xl shadow-(--shadow-inset)">
                                <button
                                    type="button"
                                    onClick={() => setAdjustType('adjustment')}
                                    className={tabCls(adjustType === 'adjustment')}
                                >
                                    재고 조정
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAdjustType('write_off');
                                        setAdjustSign('+');
                                    }}
                                    className={tabCls(adjustType === 'write_off')}
                                >
                                    폐기 처리
                                </button>
                            </div>

                            {/* Amount */}
                            <div>
                                <label className={labelCls}>
                                    <Scale size={14} />{' '}
                                    {adjustType === 'write_off' ? 'Discard Amount (kg)' : 'Amount (kg)'}
                                </label>
                                <div className="flex items-center gap-3">
                                    {adjustType === 'adjustment' && (
                                        <div className="flex rounded-xl overflow-hidden border border-black/8 dark:border-[#585d61] shrink-0">
                                            {(['+', '-'] as const).map((sign) => (
                                                <button
                                                    key={sign}
                                                    type="button"
                                                    onClick={() => setAdjustSign(sign)}
                                                    className={`w-11 h-full text-lg font-semibold transition-all duration-150 ${
                                                        adjustSign === sign
                                                            ? 'bg-primary text-white dark:bg-black'
                                                            : 'bg-white/80 dark:bg-surface-elevated text-muted'
                                                    }`}
                                                >
                                                    {sign}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <input
                                        {...NUMERIC_INPUT_PROPS}
                                        className={`${inputCls} text-2xl font-semibold p-4`}
                                        placeholder="0"
                                        value={adjustAmount}
                                        onChange={(e) => setAdjustAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                    />
                                    <div className="text-lg font-medium text-muted shrink-0">kg</div>
                                </div>
                                {(() => {
                                    const isDeduction =
                                        adjustType === 'write_off' ||
                                        (adjustType === 'adjustment' && adjustSign === '-');
                                    const current = selectedBeanId
                                        ? (stockSummaries[selectedBeanId]?.effectiveGrams ?? 0)
                                        : 0;
                                    if (isDeduction && adjustGrams > 0 && adjustGrams > current) {
                                        return (
                                            <p className="text-xs text-amber-500 dark:text-amber-400 mt-2">
                                                현재 재고({(current / 1000).toFixed(2)}kg)를 초과합니다.
                                            </p>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>

                            {/* Note */}
                            <div>
                                <label className={labelCls}>
                                    <Info size={14} /> 사유 (선택)
                                </label>
                                <input
                                    className={inputCls}
                                    placeholder={
                                        adjustType === 'write_off' ? '예: 유통기한 초과' : '예: 실측 후 재고 보정'
                                    }
                                    value={adjustNote}
                                    onChange={(e) => setAdjustNote(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                ) : tab === 'new' || tab === 'edit' ? (
                    <form
                        id="bean-form"
                        onSubmit={rhfSubmit((data) => submitBean(data))}
                        className="grid grid-cols-2 gap-6"
                    >
                        {/* Lot Name */}
                        <div className="col-span-2">
                            <label className={labelCls}>
                                <Info size={14} /> Lot Name
                            </label>
                            <input
                                className={inputCls}
                                placeholder="Origin 선택 시 자동 입력됩니다"
                                {...register('name')}
                            />
                            {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name.message}</p>}
                        </div>

                        {/* Origin */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Origin Country
                            </label>
                            <input className={inputCls} placeholder="e.g. Ethiopia" {...register('origin')} />
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                <ChipGroup
                                    items={[...COMMON_ORIGINS]}
                                    renderItem={(country) => {
                                        const selected = formValues.origin === country;
                                        return (
                                            <button
                                                key={country}
                                                type="button"
                                                onClick={() => updateOrigin(country)}
                                                className={chipCls(selected)}
                                            >
                                                {country}
                                            </button>
                                        );
                                    }}
                                />
                            </div>
                        </div>

                        {/* Region */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Region
                            </label>
                            <input className={inputCls} placeholder="e.g. Guji Zone" {...register('region')} />
                            {REGIONS_BY_ORIGIN[formValues.origin] && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {REGIONS_BY_ORIGIN[formValues.origin].map((region: string) => {
                                        const selected = formValues.region === region;
                                        return (
                                            <button
                                                key={region}
                                                type="button"
                                                onClick={() => updateRegion(region)}
                                                className={chipCls(selected)}
                                            >
                                                {region}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Farm / Producer */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Farm / Producer
                            </label>
                            <input className={inputCls} placeholder="e.g. Guji Zone" {...register('farm')} />
                            {formValues.origin && formValues.region && FARMS_BY_REGION[formValues.region] && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {FARMS_BY_REGION[formValues.region].slice(0, 5).map((farm: string) => {
                                        const selected = formValues.farm === farm;
                                        return (
                                            <button
                                                key={farm}
                                                type="button"
                                                onClick={() => updateFarm(farm)}
                                                className={chipCls(selected)}
                                            >
                                                {farm}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Variety */}
                        <div>
                            <label className={labelCls}>
                                <Info size={14} /> Variety
                            </label>
                            <input className={inputCls} placeholder="e.g. Heirloom" {...register('variety')} />
                            {formValues.origin && VARIETIES_BY_ORIGIN[formValues.origin] && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    <ChipGroup
                                        items={VARIETIES_BY_ORIGIN[formValues.origin]}
                                        renderItem={(varietyName: string) => {
                                            const selected = formValues.variety === varietyName;
                                            return (
                                                <button
                                                    key={varietyName}
                                                    type="button"
                                                    onClick={() => updateVariety(varietyName)}
                                                    className={chipCls(selected)}
                                                >
                                                    {varietyName}
                                                </button>
                                            );
                                        }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Process */}
                        <div>
                            <label className={labelCls}>
                                <Tag size={14} /> Process
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                <ChipGroup
                                    items={COMMON_PROCESSES}
                                    renderItem={(process: string) => {
                                        const selected = formValues.process === process;
                                        return (
                                            <button
                                                key={process}
                                                type="button"
                                                onClick={() => updateProcess(process)}
                                                className={chipCls(selected)}
                                            >
                                                {process}
                                            </button>
                                        );
                                    }}
                                />
                            </div>
                        </div>

                        {/* Altitude */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Altitude (masl)
                            </label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="e.g. 2100"
                                value={formValues.altitude}
                                onChange={(e) => setValue('altitude', e.target.value.replace(/\D/g, ''))}
                            />
                        </div>

                        {/* Stock */}
                        <div>
                            <label className={labelCls}>
                                <Scale size={14} /> {tab === 'edit' ? 'Current Stock (kg)' : 'Initial Stock (kg)'}
                            </label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="5"
                                value={formValues.stock}
                                onChange={(e) => setValue('stock', e.target.value.replace(/[^0-9.]/g, ''))}
                            />
                        </div>

                        {/* Capacity */}
                        <div>
                            <label className={labelCls}>
                                <Scale size={14} /> Bag Capacity (kg)
                            </label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="5"
                                value={formValues.capacity}
                                onChange={(e) => setValue('capacity', e.target.value.replace(/[^0-9.]/g, ''))}
                            />
                        </div>

                        {/* Cost per kg */}
                        <div>
                            <label className={labelCls}>
                                <Scale size={14} /> 원가 (원/kg)
                            </label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="예: 32000"
                                value={formValues.costPerKg}
                                onChange={(e) => setValue('costPerKg', e.target.value.replace(/\D/g, ''))}
                            />
                        </div>

                        {/* Tasting Notes */}
                        <div className="col-span-2">
                            <label className={labelCls}>
                                <Info size={14} /> Tasting Notes
                            </label>
                            <textarea
                                className={`${inputCls} min-h-25 resize-none`}
                                placeholder="e.g. Jasmine, Blueberry, Milk Chocolate"
                                {...register('tastingNotes')}
                            />
                        </div>
                    </form>
                ) : tab === 'expected' ? (
                    <div className="flex flex-col gap-6">
                        <BeanSelector
                            label="Select Bean"
                            visibleBeans={visibleBeans}
                            selectedBeanId={selectedBeanId}
                            showAllBeans={showAllBeans}
                            hiddenBeanCount={hiddenBeanCount}
                            stockSummaries={stockSummaries}
                            onSelect={setSelectedBeanId}
                            onShowAll={() => setShowAllBeans(true)}
                        />
                        <div
                            className="p-6 rounded-[20px] transition-opacity duration-200"
                            style={{
                                background: 'var(--color-surface-warm-solid)',
                                boxShadow: 'var(--shadow-warm)',
                                opacity: selectedBeanId ? 1 : 0.5,
                                pointerEvents: selectedBeanId ? 'auto' : 'none',
                            }}
                        >
                            <label className={labelCls}>
                                <Scale size={14} /> Expected Inbound (kg)
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    {...NUMERIC_INPUT_PROPS}
                                    className={`${inputCls} text-2xl font-semibold p-4`}
                                    placeholder="0"
                                    value={expectedAmount}
                                    onChange={(e) => setExpectedAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                />
                                <div className="text-lg font-medium text-muted">kg</div>
                            </div>
                            <label className={`${labelCls} mt-4`}>
                                <Info size={14} /> Note (optional)
                            </label>
                            <input
                                className={inputCls}
                                placeholder="e.g. PO #1234, ETA next week"
                                value={expectedNote}
                                onChange={(e) => setExpectedNote(e.target.value)}
                            />
                            <p className="text-xs text-muted mt-3">
                                Counts toward available stock for shortage alerts, not physical on-hand stock.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        {/* Bean selector */}
                        <BeanSelector
                            label="Select Bean to Restock"
                            visibleBeans={visibleBeans}
                            selectedBeanId={selectedBeanId}
                            showAllBeans={showAllBeans}
                            hiddenBeanCount={hiddenBeanCount}
                            stockSummaries={stockSummaries}
                            onSelect={setSelectedBeanId}
                            onShowAll={() => setShowAllBeans(true)}
                        />

                        {/* Restock amount */}
                        <div
                            className="p-6 rounded-[20px] transition-opacity duration-200"
                            style={{
                                background: 'var(--color-surface-warm-solid)',
                                boxShadow: 'var(--shadow-warm)',
                                opacity: selectedBeanId ? 1 : 0.5,
                                pointerEvents: selectedBeanId ? 'auto' : 'none',
                            }}
                        >
                            <label className={labelCls}>
                                <Scale size={14} /> Weight to Add (kg)
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    {...NUMERIC_INPUT_PROPS}
                                    className={`${inputCls} text-2xl font-semibold p-4`}
                                    placeholder="0"
                                    value={restockAmount}
                                    onChange={(e) => setRestockAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                />
                                <div className="text-lg font-medium text-muted">kg</div>
                            </div>

                            <div className="flex gap-2 mt-4">
                                {[
                                    { label: '+0.5kg', amount: 0.5 },
                                    { label: '+1kg', amount: 1 },
                                ].map(({ label, amount }) => (
                                    <button
                                        key={amount}
                                        type="button"
                                        onClick={() => {
                                            const parsed = parseFloat(restockAmount) || 0;
                                            setRestockAmount((Math.round((parsed + amount) * 1000) / 1000).toString());
                                        }}
                                        className="flex-1 py-3 px-4 rounded-xl border border-black/12 dark:border-[#585d61] bg-white dark:bg-surface-elevated text-primary text-sm font-semibold cursor-pointer transition-all duration-200"
                                    >
                                        {label}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setRestockAmount('')}
                                    className="py-3 px-5 rounded-xl border border-black/12 dark:border-[#585d61] bg-white dark:bg-surface-elevated text-[#e74c3c] dark:text-red-400 text-sm font-semibold cursor-pointer"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-white text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        Cancel
                    </button>
                    {tab === 'new' || tab === 'edit' ? (
                        <button
                            type="submit"
                            form="bean-form"
                            disabled={isSubmitting}
                            className="flex-2 py-3.5 rounded-2xl border border-transparent dark:border-white bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Saving...' : tab === 'new' ? 'Create Bean Lot' : 'Update Bean Details'}
                        </button>
                    ) : (
                        <button
                            disabled={isSubmitDisabled}
                            onClick={() => submitBean(getValues())}
                            className="flex-2 py-3.5 rounded-2xl border border-transparent dark:border-white bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSubmitting
                                ? 'Saving...'
                                : tab === 'restock'
                                  ? 'Confirm Restock'
                                  : tab === 'expected'
                                    ? 'Confirm Expected Inbound'
                                    : adjustType === 'write_off'
                                      ? 'Confirm Write-off'
                                      : 'Confirm Adjustment'}
                        </button>
                    )}
                </div>
            </div>
        </ModalShell>
    );
};
