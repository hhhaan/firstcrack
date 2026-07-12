import { setLanguage, supportedLanguages } from '@shared/i18n';
import { inventoryStore } from '@shared/lib/inventoryStore';
import { STOCK_HORIZON_DAYS } from '@shared/lib/stock-calc';
import { type Theme, useThemeStore } from '@shared/store/theme';
import { SectionCard } from '@shared/ui/SectionCard';
import { Languages, Moon, Package, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';

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
];

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
            <SectionCard>
                <SectionCard.Header
                    icon={<Sun size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.general.theme')}
                    description={t('settings.tabs.general.themeDescription')}
                />
                <SectionCard.Body className="grid grid-cols-2 gap-3">
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
                                        active
                                            ? 'text-[#111827] dark:text-[#e5e5e5]'
                                            : 'text-[#6B7280] dark:text-[#999]'
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
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header
                    icon={<Languages size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.general.language')}
                    description={t('settings.tabs.general.languageDescription')}
                />
                <SectionCard.Body className="grid gap-1.5">
                    {supportedLanguages.map((language) => (
                        <SettingsCheckRow
                            key={language}
                            checked={i18n.resolvedLanguage === language}
                            label={t(`language.${language}`)}
                            onChange={() => void setLanguage(language)}
                        />
                    ))}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header
                    icon={<Package size={16} strokeWidth={1.8} />}
                    title="Stock alert horizon"
                    description="Days ahead to reserve planned roasts when checking for bean shortages (default 28)."
                />
                <SectionCard.Body className="flex items-center gap-3">
                    <input
                        type="number"
                        min={1}
                        max={365}
                        value={horizonDays}
                        onChange={(e) => void saveHorizon(Number(e.target.value))}
                        className="w-24 px-3 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] text-sm"
                    />
                    <span className="text-sm text-[#6B7280] dark:text-[#999]">days</span>
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
};
