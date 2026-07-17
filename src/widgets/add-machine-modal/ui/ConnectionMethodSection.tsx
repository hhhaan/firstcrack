import { groupRoastersByBrand, listProtocols, ROASTER_REGISTRY } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { inputCls, labelCls, selectCls, tabCls } from '../lib/styles';
import type { MachineModalTab } from '../model/types';

const ROASTERS_BY_BRAND = groupRoastersByBrand(ROASTER_REGISTRY);
const PROTOCOLS = listProtocols(ROASTER_REGISTRY);

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
    tab,
    switchTab,
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
            {/* Connection method: supported vs custom tabs */}
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

            {/* Connection method: known roaster model */}
            {!isCustom && (
                <div>
                    <label className={labelCls}>{t('addMachine.roasterModel')}</label>
                    <div className="relative">
                        <select
                            className={cn(selectCls, isEdit && 'opacity-70 cursor-default')}
                            value={selectedKey}
                            onChange={(e) => selectRoaster(e.target.value)}
                            disabled={isEdit}
                        >
                            <option value="">{t('addMachine.selectRoaster')}</option>
                            {Object.entries(ROASTERS_BY_BRAND)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([brand, items]) => (
                                    <optgroup key={brand} label={brand}>
                                        {items.map(({ key, def }) => (
                                            <option key={key} value={key}>
                                                {def.display_name}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                        </select>
                        <ChevronDown
                            size={14}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
                        />
                    </div>
                </div>
            )}

            {/* Connection method: custom name / brand / protocol */}
            {isCustom && (
                <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className={labelCls}>
                            {t('addMachine.customName')}
                            {!isEdit && <span className="text-red-500"> *</span>}
                        </label>
                        <input
                            className={cn(inputCls, isEdit && 'opacity-70 cursor-default')}
                            type="text"
                            value={customName}
                            onChange={(e) => setCustomName(e.target.value)}
                            placeholder={t('addMachine.customNamePlaceholder')}
                            disabled={isEdit}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>{t('addMachine.customBrand')}</label>
                        <input
                            className={cn(inputCls, isEdit && 'opacity-70 cursor-default')}
                            type="text"
                            value={customBrand}
                            onChange={(e) => setCustomBrand(e.target.value)}
                            placeholder={t('addMachine.customBrandPlaceholder')}
                            disabled={isEdit}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>
                            {t('addMachine.protocol')}
                            <span className="text-red-500"> *</span>
                        </label>
                        <div className="relative">
                            <select
                                className={cn(selectCls, isEdit && 'opacity-70 cursor-default')}
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
                            </select>
                            <ChevronDown
                                size={13}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
