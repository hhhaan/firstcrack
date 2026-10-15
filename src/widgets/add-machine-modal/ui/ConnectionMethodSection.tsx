import { canConnectRoaster, groupRoastersByBrand, listProtocols, ROASTER_REGISTRY } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useAccountPlan } from '@shared/lib/features/useAccountPlan';
import { Badge } from '@shared/ui/Badge';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls, selectCls } from '@shared/ui/form-styles';
import { ChevronDown, Lock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MachineModalTab } from '../model/types';

const ROASTERS_BY_BRAND = groupRoastersByBrand(ROASTER_REGISTRY);
const PROTOCOLS = listProtocols(ROASTER_REGISTRY);
/** Brands roasters look up first. Unlisted brands follow, alphabetically. */
const BRAND_ORDER = [
    'Probat',
    'Giesen',
    'Loring',
    'Diedrich',
    'Bühler',
    'Proaster',
    'Easyster',
    'Kaleido',
    'Buja Roaster',
    'Trinitas',
    'Phidget',
];
const brandRank = (brand: string) => {
    const index = BRAND_ORDER.indexOf(brand);
    return index === -1 ? BRAND_ORDER.length : index;
};
const ROASTER_GROUPS = Object.entries(ROASTERS_BY_BRAND)
    .map(([brand, items]) => ({ brand, items }))
    .sort((a, b) => brandRank(a.brand) - brandRank(b.brand) || a.brand.localeCompare(b.brand));

function RoasterModelSelect({
    isEdit,
    selectedKey,
    selectRoaster,
}: {
    isEdit: boolean;
    selectedKey: string;
    selectRoaster: (key: string) => void;
}) {
    const { t } = useTranslation();
    const accountPlan = useAccountPlan();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [lockHint, setLockHint] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const groups = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return ROASTER_GROUPS;
        return ROASTER_GROUPS.filter(({ brand }) => brand.toLowerCase().includes(needle));
    }, [query]);
    const selectedName =
        ROASTER_GROUPS.flatMap((group) => group.items).find((item) => item.key === selectedKey)?.def.display_name ?? '';

    useEffect(() => {
        if (!open) return;
        searchRef.current?.focus();
        const onPointer = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('pointerdown', onPointer);
        return () => document.removeEventListener('pointerdown', onPointer);
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <div className="relative">
                {open ? (
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('addMachine.searchRoaster')}
                        aria-label={t('addMachine.searchRoaster')}
                        role="combobox"
                        aria-expanded={open}
                        aria-controls="roaster-model-list"
                        aria-autocomplete="list"
                        className={cn(selectCls, 'pr-10 placeholder:text-muted')}
                    />
                ) : (
                    <button
                        type="button"
                        className={cn(
                            selectCls,
                            'text-left',
                            !selectedName && 'text-muted',
                            isEdit && 'cursor-default opacity-70',
                        )}
                        disabled={isEdit}
                        aria-haspopup="listbox"
                        aria-expanded={false}
                        onClick={() => setOpen(true)}
                    >
                        {selectedName || t('addMachine.selectRoaster')}
                    </button>
                )}
                <button
                    type="button"
                    aria-label={open ? t('common.close') : t('addMachine.selectRoaster')}
                    disabled={isEdit}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center border-none bg-transparent text-muted dark:text-[#8a8580]"
                    onClick={() => {
                        setQuery('');
                        setOpen((value) => !value);
                    }}
                >
                    <ChevronDown size={16} strokeWidth={2} />
                </button>
            </div>
            {open && (
                <div
                    id="roaster-model-list"
                    role="listbox"
                    className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-black/8 bg-white shadow-lg dark:border-[#585d61] dark:bg-[#262b31]"
                >
                    {groups.length === 0 && (
                        <p className="px-3 py-3 text-sm text-muted">{t('addMachine.noRoasterResults')}</p>
                    )}
                    {groups.map(({ brand, items }) => (
                        <div key={brand}>
                            <div className="bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted dark:bg-[#1e2328]">
                                {brand}
                            </div>
                            {items.map(({ key, def }) => {
                                const locked = !canConnectRoaster(key, accountPlan);
                                const selected = key === selectedKey;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        aria-disabled={locked}
                                        className={cn(
                                            'flex w-full items-center gap-2 py-1 pr-3 pl-5 text-left text-sm',
                                            locked
                                                ? 'cursor-not-allowed text-muted'
                                                : 'cursor-pointer text-secondary hover:bg-surface',
                                            selected && !locked && 'font-medium text-primary',
                                        )}
                                        onClick={() => {
                                            if (locked) {
                                                setLockHint(true);
                                                return;
                                            }
                                            selectRoaster(key);
                                            setLockHint(false);
                                            setQuery('');
                                            setOpen(false);
                                        }}
                                    >
                                        <span className="min-w-0 flex-1 truncate">{def.display_name}</span>
                                        {locked && (
                                            <>
                                                <Lock
                                                    size={12}
                                                    className="shrink-0 text-[#9CA3AF] dark:text-[#666]"
                                                    aria-hidden
                                                />
                                                <Badge
                                                    size="sm"
                                                    className="bg-palette-teal/15 text-[9px] font-bold text-palette-teal"
                                                >
                                                    Enterprise
                                                </Badge>
                                            </>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {lockHint && (
                        <div className="flex items-center gap-1.5 border-t border-black/6 px-3 py-2 text-[12px] text-palette-teal dark:border-[#585d61]">
                            <Lock size={12} className="shrink-0" aria-hidden />
                            {t('machines.enterpriseOnly')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

type Props = {
    isEdit: boolean;
    isCustom: boolean;
    tab: MachineModalTab;
    switchTab: (next: MachineModalTab) => void;
    selectedKey: string;
    selectRoaster: (key: string) => void;
    customName: string;
    setCustomName: (v: string) => void;
    customBrand: string;
    setCustomBrand: (v: string) => void;
    customProtocol: string;
    selectCustomProtocol: (protocol: string) => void;
};

export const ConnectionMethodSection = ({
    isEdit,
    isCustom,
    selectedKey,
    selectRoaster,
    customName,
    setCustomName,
    customBrand,
    setCustomBrand,
    customProtocol,
    selectCustomProtocol,
}: Props) => {
    const { t } = useTranslation();

    return (
        <>
            {/* 기타 / 직접 입력 탭 임시 숨김
            {!isEdit && (
                <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                    <button
                        type="button"
                        onClick={() => switchTab('supported')}
                        className={tabCls(tab === 'supported')}
                    >
                        {t('addMachine.tabSupported')}
                    </button>
                    <button type="button" onClick={() => switchTab('custom')} className={tabCls(tab === 'custom')}>
                        {t('addMachine.tabCustom')}
                    </button>
                </div>
            )}
            */}

            {/* Connection method: known roaster model */}
            {!isCustom && (
                <div>
                    <label className={labelCls}>{t('addMachine.roasterModel')}</label>
                    <RoasterModelSelect isEdit={isEdit} selectedKey={selectedKey} selectRoaster={selectRoaster} />
                </div>
            )}

            {/* Connection method: custom name / brand / protocol */}
            {isCustom && (
                <div className="grid grid-cols-1 gap-3 border-b border-border-subtle pb-4 sm:grid-cols-3">
                    <div className="min-w-0">
                        <label htmlFor="machine-custom-name" className={labelCls}>
                            {t('addMachine.customName')}
                            {!isEdit && <span className="text-red-500"> *</span>}
                        </label>
                        <input
                            id="machine-custom-name"
                            className={cn(inputCls, isEdit && 'opacity-70 cursor-default')}
                            type="text"
                            value={customName}
                            onChange={(e) => setCustomName(e.target.value)}
                            placeholder={t('addMachine.customNamePlaceholder')}
                            disabled={isEdit}
                        />
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="machine-custom-brand" className={labelCls}>
                            {t('addMachine.customBrand')}
                        </label>
                        <input
                            id="machine-custom-brand"
                            className={cn(inputCls, isEdit && 'opacity-70 cursor-default')}
                            type="text"
                            value={customBrand}
                            onChange={(e) => setCustomBrand(e.target.value)}
                            placeholder={t('addMachine.customBrandPlaceholder')}
                            disabled={isEdit}
                        />
                    </div>
                    <div className="min-w-0">
                        <label htmlFor="machine-custom-protocol" className={labelCls}>
                            {t('addMachine.protocol')}
                            <span className="text-red-500"> *</span>
                        </label>
                        <FormSelect
                            id="machine-custom-protocol"
                            className={cn(isEdit && 'opacity-70 cursor-default')}
                            value={customProtocol}
                            onChange={(e) => selectCustomProtocol(e.target.value)}
                            disabled={isEdit}
                        >
                            <option value="">{t('addMachine.selectProtocol')}</option>
                            {PROTOCOLS.map((p) => (
                                <option key={p} value={p}>
                                    {p.toUpperCase()}
                                </option>
                            ))}
                        </FormSelect>
                    </div>
                </div>
            )}
        </>
    );
};
