import { setLanguage, supportedLanguages } from '@shared/i18n';
import { inventoryStore } from '@shared/lib/inventoryStore';
import { STOCK_HORIZON_DAYS } from '@shared/lib/stock-calc';
import { useShortcutStore } from '@shared/store/keyboard-shortcuts';
import {
    moveSidebarItem,
    resetSidebarOrder,
    SIDEBAR_GROUPS,
    setSidebarItemHidden,
    useSidebarPreferences,
} from '@shared/store/sidebar-preferences';
// VOC: restore dark/system picker
// import { type Theme, useThemeStore } from '@shared/store/theme';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls } from '@shared/ui/form-styles';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionLabelCls } from './SettingsOptionRow';
import { SettingsRow, SettingsSection } from './SettingsSection';

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

const moveButtonCls =
    'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-secondary hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

function SidebarOrderSection() {
    const { t } = useTranslation();
    const { order, hidden } = useSidebarPreferences();
    const hiddenIds = new Set(hidden);

    return (
        <SettingsSection>
            <SettingsSection.Header
                title={t('settings.tabs.general.sidebar')}
                description={t('settings.tabs.general.sidebarDescription')}
            />
            <SettingsSection.Body className="flex flex-col gap-4">
                {SIDEBAR_GROUPS.map((group) => {
                    const ids = order.filter((id) => (group.ids as readonly string[]).includes(id));
                    return (
                        <div key={group.labelKey} data-sidebar-group={group.labelKey}>
                            <h3 className="m-0 mb-1 text-xs font-medium text-muted">{t(group.labelKey)}</h3>
                            {ids.map((id, index) => {
                                const name = t(`sidebar.nav.${id}`);
                                const isHidden = hiddenIds.has(id);
                                return (
                                    <SettingsOptionRow key={id} justify="between">
                                        <span
                                            className={
                                                isHidden ? 'text-[13px] font-medium text-muted' : settingsOptionLabelCls
                                            }
                                            data-sidebar-item={id}
                                            data-sidebar-hidden={isHidden ? 'true' : 'false'}
                                        >
                                            {name}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1">
                                            <button
                                                type="button"
                                                aria-pressed={isHidden}
                                                aria-label={t(
                                                    isHidden
                                                        ? 'settings.tabs.general.sidebarShow'
                                                        : 'settings.tabs.general.sidebarHide',
                                                    { name },
                                                )}
                                                onClick={() => setSidebarItemHidden(id, !isHidden)}
                                                className={moveButtonCls}
                                            >
                                                {isHidden ? (
                                                    <EyeOff size={14} aria-hidden />
                                                ) : (
                                                    <Eye size={14} aria-hidden />
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={t('settings.tabs.general.sidebarMoveUp', { name })}
                                                disabled={index === 0}
                                                onClick={() => moveSidebarItem(id, -1)}
                                                className={moveButtonCls}
                                            >
                                                <ArrowUp size={14} aria-hidden />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={t('settings.tabs.general.sidebarMoveDown', { name })}
                                                disabled={index === ids.length - 1}
                                                onClick={() => moveSidebarItem(id, 1)}
                                                className={moveButtonCls}
                                            >
                                                <ArrowDown size={14} aria-hidden />
                                            </button>
                                        </span>
                                    </SettingsOptionRow>
                                );
                            })}
                        </div>
                    );
                })}
                <div className="border-t border-border-subtle pt-3">
                    <SurfaceButton onClick={() => resetSidebarOrder()}>
                        {t('settings.tabs.general.sidebarReset')}
                    </SurfaceButton>
                </div>
            </SettingsSection.Body>
        </SettingsSection>
    );
}

export const GeneralSettingsTab = () => {
    const { t, i18n } = useTranslation();
    // VOC: restore dark/system picker
    // const theme = useThemeStore((s) => s.theme);
    // const setTheme = useThemeStore((s) => s.setTheme);
    // const activeTheme = theme ?? 'system';
    const [horizonDays, setHorizonDays] = useState<number | ''>(STOCK_HORIZON_DAYS);
    const savedHorizonRef = useRef(STOCK_HORIZON_DAYS);

    useEffect(() => {
        void inventoryStore.getHorizonDays().then((days) => {
            savedHorizonRef.current = days;
            setHorizonDays(days);
        });
    }, []);

    const saveHorizon = async (value: number) => {
        const next = Math.max(1, Math.min(365, value));
        savedHorizonRef.current = next;
        setHorizonDays(next);
        await inventoryStore.setHorizonDays(next);
    };

    return (
        <div className="grid gap-8">
            <SettingsSection>
                <SettingsSection.Header title={t('settings.groups.workspace')} />
                <SettingsSection.Body className="divide-y divide-border-subtle p-0">
                    <SettingsRow
                        controlId="settings-language"
                        label={t('settings.tabs.general.language')}
                        description={t('settings.tabs.general.languageDescription')}
                    >
                        <FormSelect
                            id="settings-language"
                            aria-describedby="settings-language-description"
                            value={i18n.resolvedLanguage}
                            onChange={(event) => {
                                const language = supportedLanguages.find((value) => value === event.target.value);
                                if (language) void setLanguage(language);
                            }}
                            wrapperClassName="w-40 max-w-full"
                            className="rounded-lg py-1.5 text-[13px]"
                        >
                            {supportedLanguages.map((language) => (
                                <option key={language} value={language}>
                                    {t(`language.${language}`)}
                                </option>
                            ))}
                        </FormSelect>
                    </SettingsRow>
                    <SettingsRow
                        controlId="settings-horizon"
                        label={t('settings.tabs.general.stockHorizon')}
                        description={t('settings.tabs.general.stockHorizonDescription')}
                    >
                        <input
                            id="settings-horizon"
                            aria-describedby="settings-horizon-description"
                            type="number"
                            min={1}
                            max={365}
                            value={horizonDays}
                            onChange={(event) => {
                                const raw = event.currentTarget.value;
                                if (raw === '') {
                                    setHorizonDays('');
                                    return;
                                }
                                const next = event.currentTarget.valueAsNumber;
                                if (!Number.isFinite(next)) return;
                                void saveHorizon(next);
                            }}
                            onBlur={() => {
                                if (horizonDays === '') setHorizonDays(savedHorizonRef.current);
                            }}
                            className={`${inputCls} w-20 rounded-lg py-1.5 text-[13px]`}
                        />
                        <span className="text-[12px] text-muted">{t('settings.tabs.general.days')}</span>
                    </SettingsRow>
                    <SettingsRow
                        controlId="settings-shortcuts"
                        label={t('shortcuts.title')}
                        description={t('shortcuts.description')}
                    >
                        <SurfaceButton
                            id="settings-shortcuts"
                            aria-label={t('shortcuts.edit')}
                            aria-describedby="settings-shortcuts-description"
                            onClick={() => useShortcutStore.getState().setDialogOpen(true)}
                        >
                            {t('shortcuts.edit')}
                        </SurfaceButton>
                    </SettingsRow>
                </SettingsSection.Body>
            </SettingsSection>
            <SidebarOrderSection />
        </div>
    );
};
