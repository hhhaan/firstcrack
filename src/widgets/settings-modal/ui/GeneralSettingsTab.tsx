import { setLanguage, supportedLanguages } from '@shared/i18n';
import { inventoryStore } from '@shared/lib/inventoryStore';
import { STOCK_HORIZON_DAYS } from '@shared/lib/stock-calc';
import { type Theme, useThemeStore } from '@shared/store/theme';
import { Languages, Moon, Package, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const themeOptions: { value: Theme; icon: typeof Sun; labelKey: string; descKey: string }[] = [
    {
        value: 'light',
        icon: Sun,
        labelKey: 'settings.tabs.general.themeLight',
        descKey: 'settings.tabs.general.themeLightDescription',
    },
    {
        value: 'dark',
        icon: Moon,
        labelKey: 'settings.tabs.general.themeDark',
        descKey: 'settings.tabs.general.themeDarkDescription',
    },
    // {
    //     value: 'system',
    //     icon: Monitor,
    //     labelKey: 'settings.tabs.general.themeSystem',
    //     descKey: 'settings.tabs.general.themeSystemDescription',
    // },
];

const sectionCls = 'bg-white dark:bg-[#181d21] border border-[#E5E7EB] dark:border-[#585d61] rounded-xl p-5';

export const GeneralSettingsTab = () => {
    const { t, i18n } = useTranslation();
    const theme = useThemeStore((s) => s.theme);
    const setTheme = useThemeStore((s) => s.setTheme);
    const activeTheme = theme ?? 'system';
    const [horizonDays, setHorizonDays] = useState(STOCK_HORIZON_DAYS);

    useEffect(() => {
        void inventoryStore.getHorizonDays().then(setHorizonDays);
    }, []);

    const saveHorizon = async (value: number) => {
        const next = Math.max(1, Math.min(365, value));
        setHorizonDays(next);
        await inventoryStore.setHorizonDays(next);
    };

    return (
        <div className="grid gap-4">
            <section className={sectionCls}>
                <div className="mb-4">
                    <div className="flex items-center gap-2 mb-0.5">
                        <Sun size={16} strokeWidth={1.8} className="text-[#6B7280] dark:text-[#999] shrink-0" />
                        <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0">
                            {t('settings.tabs.general.theme')}
                        </h4>
                    </div>
                    <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                        {t('settings.tabs.general.themeDescription')}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    {themeOptions.map(({ value, icon: Icon, labelKey, descKey }) => {
                        const active = activeTheme === value;

                        return (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setTheme(value)}
                                className={`flex flex-col items-center gap-2.5 px-4 py-4 rounded-xl border-2 cursor-pointer transition-all text-center ${
                                    active
                                        ? 'border-[#E5E7EB] dark:border-[#585D61] bg-[#F9FAFB] dark:bg-[#262B31]'
                                        : 'border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] hover:border-[#9CA3AF] dark:hover:border-[#666]'
                                }`}
                            >
                                <Icon
                                    size={22}
                                    strokeWidth={1.8}
                                    className={
                                        active ? 'text-[#111827] dark:text-white' : 'text-[#6B7280] dark:text-[#999]'
                                    }
                                />
                                <div>
                                    <div
                                        className={`text-[13px] ${
                                            active
                                                ? 'font-semibold text-[#111827] dark:text-[#e5e5e5]'
                                                : 'font-medium text-[#374151] dark:text-[#ccc]'
                                        }`}
                                    >
                                        {t(labelKey)}
                                    </div>
                                    <div className="text-[11px] text-[#6B7280] dark:text-[#999] mt-0.5">
                                        {t(descKey)}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className={sectionCls}>
                <div className="mb-4">
                    <div className="flex items-center gap-2 mb-0.5">
                        <Languages size={16} strokeWidth={1.8} className="text-[#6B7280] dark:text-[#999] shrink-0" />
                        <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0">
                            {t('settings.tabs.general.language')}
                        </h4>
                    </div>
                    <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                        {t('settings.tabs.general.languageDescription')}
                    </p>
                </div>

                <div className="grid gap-1.5">
                    {supportedLanguages.map((language) => {
                        const active = i18n.resolvedLanguage === language;

                        return (
                            <label
                                key={language}
                                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => void setLanguage(language)}
                                    className="w-4 h-4 accent-[#111827] dark:accent-[#F2F2F2]"
                                />
                                <span className="text-[14px] font-medium text-[#111827] dark:text-[#e5e5e5]">
                                    {t(`language.${language}`)}
                                </span>
                            </label>
                        );
                    })}
                </div>
            </section>

            <section className={sectionCls}>
                <div className="mb-4">
                    <div className="flex items-center gap-2 mb-0.5">
                        <Package size={16} strokeWidth={1.8} className="text-[#6B7280] dark:text-[#999] shrink-0" />
                        <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0">
                            Stock alert horizon
                        </h4>
                    </div>
                    <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                        Days ahead to reserve planned roasts when checking for bean shortages (default 28).
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="number"
                        min={1}
                        max={365}
                        value={horizonDays}
                        onChange={(e) => void saveHorizon(Number(e.target.value))}
                        className="w-24 px-3 py-2 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] text-sm"
                    />
                    <span className="text-sm text-[#6B7280] dark:text-[#999]">days</span>
                </div>
            </section>
        </div>
    );
};
