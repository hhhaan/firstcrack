import { setLanguage, supportedLanguages } from '@shared/i18n';
import { inventoryStore } from '@shared/lib/inventoryStore';
import { STOCK_HORIZON_DAYS } from '@shared/lib/stock-calc';
// VOC: restore dark/system picker
// import { type Theme, useThemeStore } from '@shared/store/theme';
import { SectionCard } from '@shared/ui/SectionCard';
import { Languages, Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';

/*
VOC: restore dark/system picker — uncomment themeOptions / MiniWindow / ThemePreview
and the theme SectionCard in GeneralSettingsTab.

const themeOptions: { value: Theme; labelKey: string; descKey: string }[] = [
    {
        value: 'light',
        labelKey: 'settings.tabs.general.themeLight',
        descKey: 'settings.tabs.general.themeLightDescription',
    },
    {
        value: 'dark',
        labelKey: 'settings.tabs.general.themeDark',
        descKey: 'settings.tabs.general.themeDarkDescription',
    },
    {
        value: 'system',
        labelKey: 'settings.tabs.general.themeSystem',
        descKey: 'settings.tabs.general.themeSystemDescription',
    },
];

const MiniWindow = ({ dark }: { dark: boolean }) => (
    <div className={`flex h-full flex-col ${dark ? 'bg-[#1b1b1f]' : 'bg-[#f8fafc]'}`}>
        <div className={`flex h-5 shrink-0 items-center gap-1 px-2 ${dark ? 'bg-[#3b3a42]' : 'bg-[#d7dce6]'}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff6257]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
            <span className={`h-1.5 w-[38%] rounded-full ${dark ? 'bg-[#5f5bff]' : 'bg-[#3f82f5]'}`} />
            <span className={`h-1.5 w-[68%] rounded-full ${dark ? 'bg-[#46464e]' : 'bg-[#c7ced9]'}`} />
            <span className={`h-1.5 w-[52%] rounded-full ${dark ? 'bg-[#46464e]' : 'bg-[#c7ced9]'}`} />
        </div>
    </div>
);

const ThemePreview = ({ value }: { value: Theme }) => {
    if (value === 'system') {
        return (
            <div className="grid h-full grid-cols-2">
                <MiniWindow dark={false} />
                <MiniWindow dark />
            </div>
        );
    }

    return <MiniWindow dark={value === 'dark'} />;
};

// In GeneralSettingsTab return, first SectionCard:
            <SectionCard>
                <SectionCard.Header
                    title={t('settings.tabs.general.theme')}
                    description={t('settings.tabs.general.themeDescription')}
                />
                <SectionCard.Body className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {themeOptions.map(({ value, labelKey, descKey }) => {
                        const active = activeTheme === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setTheme(value)}
                                aria-pressed={active}
                                aria-label={`${t(labelKey)}: ${t(descKey)}`}
                                data-theme-option={value}
                            >
                                <ThemePreview value={value} />
                                {t(labelKey)}
                            </button>
                        );
                    })}
                </SectionCard.Body>
            </SectionCard>
*/

export const GeneralSettingsTab = () => {
    const { t, i18n } = useTranslation();
    // VOC: restore dark/system picker
    // const theme = useThemeStore((s) => s.theme);
    // const setTheme = useThemeStore((s) => s.setTheme);
    // const activeTheme = theme ?? 'system';
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
