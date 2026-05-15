import { useEffect, useState } from 'react';
import { X, Info, Scale, MapPin, Tag, Search, Check } from 'lucide-react';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import type { Bean } from '@shared/types/database.types';
import {
    COMMON_ORIGINS,
    REGIONS_BY_ORIGIN,
    FARMS_BY_REGION,
    COMMON_PROCESSES,
    VARIETIES_BY_ORIGIN,
    buildAutoName,
} from '@entities/bean/lib/coffee-origins';
import { useAddBeanSubmit } from './useAddBeanSubmit';

// ── 모듈 레벨 상수 ──────────────────────────────────────────

const NUMERIC_INPUT_PROPS = {
    type: 'text' as const,
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
} satisfies Partial<React.InputHTMLAttributes<HTMLInputElement>>;

const chipCls = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150 border ${
        selected ? 'border-primary bg-primary text-white' : 'border-black/10 bg-white/70 text-secondary'
    }`;

const tabCls = (active: boolean) =>
    `flex-1 py-3 rounded-xl border-none text-sm cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white font-semibold text-primary shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted'
    }`;

// ── 공통 입력 필드 ───────────────────────────────────────────

const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';
const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';

const ChipGroup = ({
    items,
    renderItem,
    limit = 6,
}: {
    items: string[];
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
                    className="px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer border border-black/10 bg-white/70 text-muted"
                >
                    +{hiddenCount}
                </button>
            )}
        </>
    );
};

// ──────────────────────────────────────────────────────────────

interface AddBeanModalProps {
    open: boolean;
    onClose: () => void;
    userId: string;
    existingBeans: Bean[];
    initialTab?: 'new' | 'restock' | 'edit';
    initialBeanId?: string | null;
    initialData?: Bean | null;
    onSuccess?: (bean: Bean | null) => void;
}

const EMPTY_FORM = {
    name: '',
    origin: '',
    region: '',
    farm: '',
    process: 'Washed',
    variety: '',
    altitude: '',
    stock: '',
    capacity: '5000',
    costPerKg: '',
    tastingNotes: '',
};

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
    const [tab, setTab] = useState<'new' | 'restock' | 'edit'>(initialTab);
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(initialBeanId);
    const [restockAmount, setRestockAmount] = useState('');
    const [nameIsAuto, setNameIsAuto] = useState(true);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [showAllBeans, setShowAllBeans] = useState(false);

    const { handleSubmit, isSubmitting } = useAddBeanSubmit({
        userId,
        tab,
        formData,
        selectedBeanId,
        restockAmount,
        existingBeans,
        initialData: initialData ?? null,
        onSuccess,
        onClose,
    });

    useEffect(() => {
        if (!open) return;
        setTab(initialTab);
        setSelectedBeanId(initialBeanId);
        setRestockAmount('');
        setShowAllBeans(false);
        const hasData = initialData && (initialTab === 'edit' || initialTab === 'new');
        setNameIsAuto(!hasData);
        setFormData(
            hasData
                ? {
                      name: initialData.name ?? '',
                      origin: initialData.origin ?? '',
                      region: initialData.region ?? '',
                      farm: initialData.farm ?? '',
                      process: initialData.process ?? 'Washed',
                      variety: initialData.variety ?? '',
                      altitude: initialData.altitude_masl?.toString() ?? '',
                      stock: initialData.stock_grams?.toString() ?? '',
                      capacity: initialData.capacity_grams?.toString() ?? '5000',
                      costPerKg: initialData.cost_per_kg?.toString() ?? '',
                      tastingNotes: initialData.tasting_notes ?? '',
                  }
                : EMPTY_FORM,
        );
    }, [open, initialTab, initialBeanId, initialData]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

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

    const isSubmitDisabled = isSubmitting || (tab === 'restock' && (!selectedBeanId || !restockAmount));

    const BEAN_LIMIT = 4;
    const visibleBeans = showAllBeans ? existingBeans : existingBeans.slice(0, BEAN_LIMIT);
    const hiddenBeanCount = existingBeans.length - BEAN_LIMIT;

    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="add-bean-modal-title"
            contentClassName="max-w-[640px] w-full max-h-[min(860px,calc(100vh-64px))] flex flex-col rounded-[28px] bg-[rgba(255,255,255,0.96)] backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white overflow-hidden"
        >
            {/* Header */}
            <div className="shrink-0 bg-white/60 backdrop-blur-sm z-10 border-b border-black/4">
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                    <div className="flex items-center gap-3.5">
                        <h2
                            id="add-bean-modal-title"
                            className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                        >
                            {tab === 'new' ? 'New Bean Lot' : tab === 'edit' ? 'Edit Bean Details' : 'Restock Existing'}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>

                {tab !== 'edit' && (
                    <div className="px-8 pb-5">
                        <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                            <button onClick={() => setTab('new')} className={tabCls(tab === 'new')}>
                                New Arrival
                            </button>
                            <button onClick={() => setTab('restock')} className={tabCls(tab === 'restock')}>
                                Restock Existing
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable Body */}
            <div className="p-8 overflow-y-auto flex-1">
                {tab === 'new' || tab === 'edit' ? (
                    <div className="grid grid-cols-2 gap-6">
                        {/* Lot Name */}
                        <div className="col-span-2">
                            <label className={labelCls}>
                                <Info size={14} /> Lot Name
                            </label>
                            <input
                                className={inputCls}
                                placeholder="Origin 선택 시 자동 입력됩니다"
                                value={formData.name}
                                onChange={(e) => {
                                    setNameIsAuto(false);
                                    setFormData({ ...formData, name: e.target.value });
                                }}
                            />
                        </div>

                        {/* Origin */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Origin Country
                            </label>
                            <input
                                className={inputCls}
                                placeholder="e.g. Ethiopia"
                                value={formData.origin}
                                onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                            />
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {COMMON_ORIGINS.map((country) => {
                                    const selected = formData.origin === country;
                                    return (
                                        <button
                                            key={country}
                                            type="button"
                                            onClick={() => {
                                                const newOrigin = selected ? '' : country;
                                                const newRegion = selected ? formData.region : '';
                                                const newFarm = selected ? formData.farm : '';
                                                const newVariety = selected ? formData.variety : '';
                                                setFormData({
                                                    ...formData,
                                                    origin: newOrigin,
                                                    region: newRegion,
                                                    farm: newFarm,
                                                    variety: newVariety,
                                                    name: nameIsAuto
                                                        ? buildAutoName(newOrigin, newRegion, newFarm, newVariety)
                                                        : formData.name,
                                                });
                                            }}
                                            className={chipCls(selected)}
                                        >
                                            {country}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Region */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Region
                            </label>
                            <input
                                className={inputCls}
                                placeholder="e.g. Guji Zone"
                                value={formData.region}
                                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                            />
                            {REGIONS_BY_ORIGIN[formData.origin] && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {REGIONS_BY_ORIGIN[formData.origin].map((region) => {
                                        const selected = formData.region === region;
                                        return (
                                            <button
                                                key={region}
                                                type="button"
                                                onClick={() => {
                                                    const newRegion = selected ? '' : region;
                                                    const newFarm = selected ? formData.farm : '';
                                                    setFormData({
                                                        ...formData,
                                                        region: newRegion,
                                                        farm: newFarm,
                                                        name: nameIsAuto
                                                            ? buildAutoName(
                                                                  formData.origin,
                                                                  newRegion,
                                                                  newFarm,
                                                                  formData.variety,
                                                              )
                                                            : formData.name,
                                                    });
                                                }}
                                                className={chipCls(selected)}
                                            >
                                                {region}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Farm */}
                        <div>
                            <label className={labelCls}>
                                <MapPin size={14} /> Farm / Washing Station
                            </label>
                            <input
                                className={inputCls}
                                placeholder="e.g. Shakiso Cooperative"
                                value={formData.farm}
                                onChange={(e) => setFormData({ ...formData, farm: e.target.value })}
                            />
                            {FARMS_BY_REGION[formData.region] && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {FARMS_BY_REGION[formData.region].map((farmName) => {
                                        const selected = formData.farm === farmName;
                                        return (
                                            <button
                                                key={farmName}
                                                type="button"
                                                onClick={() => {
                                                    const newFarm = selected ? '' : farmName;
                                                    setFormData({
                                                        ...formData,
                                                        farm: newFarm,
                                                        name: nameIsAuto
                                                            ? buildAutoName(
                                                                  formData.origin,
                                                                  formData.region,
                                                                  newFarm,
                                                                  formData.variety,
                                                              )
                                                            : formData.name,
                                                    });
                                                }}
                                                className={chipCls(selected)}
                                            >
                                                {farmName}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Variety */}
                        <div>
                            <label className={labelCls}>
                                <Tag size={14} /> Variety
                            </label>
                            <input
                                className={inputCls}
                                placeholder="e.g. Heirloom, SL28"
                                value={formData.variety}
                                onChange={(e) => setFormData({ ...formData, variety: e.target.value })}
                            />
                            {VARIETIES_BY_ORIGIN[formData.origin] && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    <ChipGroup
                                        items={VARIETIES_BY_ORIGIN[formData.origin]}
                                        renderItem={(varietyName) => {
                                            const selected = formData.variety === varietyName;
                                            return (
                                                <button
                                                    key={varietyName}
                                                    type="button"
                                                    onClick={() => {
                                                        const newVariety = selected ? '' : varietyName;
                                                        setFormData({
                                                            ...formData,
                                                            variety: newVariety,
                                                            name: nameIsAuto
                                                                ? buildAutoName(
                                                                      formData.origin,
                                                                      formData.region,
                                                                      formData.farm,
                                                                      newVariety,
                                                                  )
                                                                : formData.name,
                                                        });
                                                    }}
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
                                {COMMON_PROCESSES.map((process) => {
                                    const selected = formData.process === process;
                                    return (
                                        <button
                                            key={process}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, process })}
                                            className={chipCls(selected)}
                                        >
                                            {process}
                                        </button>
                                    );
                                })}
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
                                value={formData.altitude}
                                onChange={(e) =>
                                    setFormData({ ...formData, altitude: e.target.value.replace(/\D/g, '') })
                                }
                            />
                        </div>

                        {/* Stock */}
                        <div>
                            <label className={labelCls}>
                                <Scale size={14} /> {tab === 'edit' ? 'Current Stock (g)' : 'Initial Stock (g)'}
                            </label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="5000"
                                value={formData.stock}
                                onChange={(e) => setFormData({ ...formData, stock: e.target.value.replace(/\D/g, '') })}
                            />
                        </div>

                        {/* Capacity */}
                        <div>
                            <label className={labelCls}>
                                <Scale size={14} /> Bag Capacity (g)
                            </label>
                            <input
                                {...numericProps}
                                className={inputCls}
                                placeholder="5000"
                                value={formData.capacity}
                                onChange={(e) =>
                                    setFormData({ ...formData, capacity: e.target.value.replace(/\D/g, '') })
                                }
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
                                value={formData.costPerKg}
                                onChange={(e) =>
                                    setFormData({ ...formData, costPerKg: e.target.value.replace(/\D/g, '') })
                                }
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
                                value={formData.tastingNotes}
                                onChange={(e) => setFormData({ ...formData, tastingNotes: e.target.value })}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        {/* Bean selector */}
                        <div>
                            <label className={labelCls}>
                                <Search size={14} /> Select Bean to Restock
                            </label>
                            <div className="grid gap-2.5 p-1">
                                {visibleBeans.map((bean) => {
                                    const isSelected = selectedBeanId === bean.id;
                                    return (
                                        <div
                                            key={bean.id}
                                            onClick={() => setSelectedBeanId(bean.id)}
                                            className={`px-4.5 py-3.5 rounded-2xl border border-black/6 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                                                isSelected
                                                    ? 'bg-primary text-white shadow-[0_8px_20px_rgba(0,0,0,0.12)]'
                                                    : 'bg-white/70 text-primary shadow-(--shadow-ring)'
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
                                                    {bean.stock_grams.toLocaleString()}g
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {!showAllBeans && hiddenBeanCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAllBeans(true)}
                                        className="py-2.5 rounded-2xl border border-black/6 bg-white/50 text-sm font-medium text-muted cursor-pointer hover:bg-white/80 transition-all duration-200"
                                    >
                                        +{hiddenBeanCount} more
                                    </button>
                                )}
                            </div>
                        </div>

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
                                <Scale size={14} /> Weight to Add (g)
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    {...numericProps}
                                    className={`${inputCls} text-2xl font-semibold p-4`}
                                    placeholder="0"
                                    value={restockAmount}
                                    onChange={(e) => setRestockAmount(e.target.value.replace(/\D/g, ''))}
                                />
                                <div className="text-lg font-medium text-muted">grams</div>
                            </div>

                            <div className="flex gap-2 mt-4">
                                {[
                                    { label: '+500g', amount: 500 },
                                    { label: '+1kg', amount: 1000 },
                                ].map(({ label, amount }) => (
                                    <button
                                        key={amount}
                                        type="button"
                                        onClick={() => {
                                            const parsed = parseInt(restockAmount) || 0;
                                            setRestockAmount((parsed + amount).toString());
                                        }}
                                        className="flex-1 py-3 px-4 rounded-xl border border-black/12 bg-white text-primary text-sm font-semibold cursor-pointer transition-all duration-200"
                                    >
                                        {label}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setRestockAmount('')}
                                    className="py-3 px-5 rounded-xl border border-black/12 bg-white text-[#e74c3c] text-sm font-semibold cursor-pointer"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-8 pt-5 pb-8 bg-white/80 backdrop-blur-sm border-t border-black/4 shrink-0">
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface text-secondary text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        Cancel
                    </button>
                    <button
                        disabled={isSubmitDisabled}
                        onClick={handleSubmit}
                        className="flex-2 py-3.5 rounded-2xl border-none bg-primary text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isSubmitting
                            ? 'Saving...'
                            : tab === 'new'
                              ? 'Create Bean Lot'
                              : tab === 'edit'
                                ? 'Update Bean Details'
                                : 'Confirm Restock'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
