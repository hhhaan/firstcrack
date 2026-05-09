import { useEffect, useMemo, useState } from 'react';
import { Bell, Database, Flame, Languages, LayoutDashboard, PlayCircle, Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { setLanguage, supportedLanguages } from '@shared/i18n';
import {
    useRoastSettings,
    updateRoastSettings,
    type PollIntervalMs,
    type RorSpanSec,
    type TemperatureUnit,
} from '@shared/store/roastSettings';

export type SettingsTabId = 'general' | 'notifications' | 'session' | 'system' | 'roast';

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
    initialTab?: SettingsTabId;
}

const getTabs = (
    t: (key: string) => string,
): {
    id: SettingsTabId;
    label: string;
    icon: typeof LayoutDashboard;
    title: string;
    description: string;
    cards: Array<{
        title: string;
        description: string;
        items: string[];
    }>;
}[] => [
    {
        id: 'general',
        label: t('settings.tabs.general.label'),
        icon: LayoutDashboard,
        title: t('settings.tabs.general.title'),
        description: t('settings.tabs.general.description'),
        cards: [
            {
                title: t('settings.tabs.general.interfaceTitle'),
                description: t('settings.tabs.general.interfaceDescription'),
                items: [
                    t('settings.tabs.general.defaultLandingView'),
                    t('settings.tabs.general.temperatureUnit'),
                    t('settings.tabs.general.weightUnit'),
                ],
            },
            {
                title: t('settings.tabs.general.displayTitle'),
                description: t('settings.tabs.general.displayDescription'),
                items: [
                    t('settings.tabs.general.expandedSidebar'),
                    t('settings.tabs.general.liveMetricsPanel'),
                    t('settings.tabs.general.compactDataCards'),
                ],
            },
        ],
    },
    {
        id: 'notifications',
        label: t('settings.tabs.notifications.label'),
        icon: Bell,
        title: t('settings.tabs.notifications.title'),
        description: t('settings.tabs.notifications.description'),
        cards: [
            {
                title: t('settings.tabs.notifications.operationalTitle'),
                description: t('settings.tabs.notifications.operationalDescription'),
                items: [
                    t('settings.tabs.notifications.milestoneAlerts'),
                    t('settings.tabs.notifications.disconnectWarning'),
                    t('settings.tabs.notifications.maintenanceReminder'),
                ],
            },
            {
                title: t('settings.tabs.notifications.deliveryTitle'),
                description: t('settings.tabs.notifications.deliveryDescription'),
                items: [
                    t('settings.tabs.notifications.bannerNotifications'),
                    t('settings.tabs.notifications.soundAlerts'),
                    t('settings.tabs.notifications.highPriorityOnly'),
                ],
            },
        ],
    },
    {
        id: 'session',
        label: t('settings.tabs.session.label'),
        icon: PlayCircle,
        title: t('settings.tabs.session.title'),
        description: t('settings.tabs.session.description'),
        cards: [
            {
                title: t('settings.tabs.session.startTitle'),
                description: t('settings.tabs.session.startDescription'),
                items: [
                    t('settings.tabs.session.autoStartTimer'),
                    t('settings.tabs.session.openActiveRoast'),
                    t('settings.tabs.session.confirmBeforeStart'),
                ],
            },
            {
                title: t('settings.tabs.session.endTitle'),
                description: t('settings.tabs.session.endDescription'),
                items: [
                    t('settings.tabs.session.showSummary'),
                    t('settings.tabs.session.confirmDiscard'),
                    t('settings.tabs.session.keepNotesVisible'),
                ],
            },
        ],
    },
    {
        id: 'system',
        label: t('settings.tabs.system.label'),
        icon: Database,
        title: t('settings.tabs.system.title'),
        description: t('settings.tabs.system.description'),
        cards: [
            {
                title: t('settings.tabs.system.dataTitle'),
                description: t('settings.tabs.system.dataDescription'),
                items: [
                    t('settings.tabs.system.exportWorkspace'),
                    t('settings.tabs.system.backupSnapshot'),
                    t('settings.tabs.system.preserveLogs'),
                ],
            },
            {
                title: t('settings.tabs.system.environmentTitle'),
                description: t('settings.tabs.system.environmentDescription'),
                items: [
                    t('settings.tabs.system.healthBadge'),
                    t('settings.tabs.system.checkServices'),
                    t('settings.tabs.system.confirmResets'),
                ],
            },
        ],
    },
    {
        id: 'roast',
        label: 'Roast',
        icon: Flame,
        title: 'Roast Settings',
        description: 'Customize update rate, RoR calculation, and data visibility during an active roasting session.',
        cards: [],
    },
];

export const SettingsModal = ({ open, onClose, initialTab }: SettingsModalProps) => {
    const { t, i18n } = useTranslation();
    const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab ?? 'general');
    const tabs = useMemo(() => getTabs(t), [t]);
    const roastSettings = useRoastSettings();

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    useEffect(() => {
        if (open) {
            setActiveTab(initialTab ?? 'general');
        }
    }, [open, initialTab]);

    if (!open) {
        return null;
    }

    const activeConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
    const ActiveIcon = activeConfig.icon;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="settings-modal-title"
            contentClassName="max-w-[920px] w-full max-h-[min(780px,calc(100vh-48px))] flex flex-col rounded-3xl bg-[rgba(255,255,255,0.95)] shadow-[0_24px_60px_rgba(22,18,12,0.2)] border border-[rgba(0,0,0,0.08)] overflow-hidden"
        >
            <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5 border-b border-border-subtle bg-linear-to-b from-[rgba(248,245,240,0.72)] to-[rgba(255,255,255,0.92)]">
                <div>
                    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-surface-warm-solid text-secondary text-xs font-semibold tracking-[0.12px] mb-3.5">
                        <Shield size={14} strokeWidth={1.8} />
                        {t('settings.title')}
                    </div>
                    <h2 id="settings-modal-title" className="m-0 text-[0px] leading-0">
                        {t('settings.title')}
                    </h2>
                </div>

                <button
                    onClick={onClose}
                    aria-label={t('settings.close')}
                    className="w-9 h-9 rounded-[10px] border-none bg-surface text-muted flex items-center justify-center cursor-pointer shrink-0 shadow-inset"
                >
                    <X size={16} strokeWidth={1.9} />
                </button>
            </div>

            <div className="grid grid-cols-[240px_minmax(0,1fr)] min-h-0 flex-1">
                <aside className="p-5 border-r border-border-subtle bg-[rgba(247,244,240,0.64)] overflow-y-auto">
                    <div className="grid gap-2 p-1.5 rounded-[20px] bg-[rgba(255,255,255,0.55)] shadow-inset">
                        {tabs.map(({ id, label, icon: Icon }) => {
                            const active = id === activeTab;

                            return (
                                <button
                                    key={id}
                                    onClick={() => setActiveTab(id)}
                                    className={`flex items-center gap-2.5 w-full px-3.5 py-3 rounded-[14px] border-none cursor-pointer text-left transition-all duration-[0.18s] ease-in-out ${
                                        active
                                            ? 'bg-[rgba(255,255,255,0.96)] text-primary shadow-card'
                                            : 'bg-transparent text-secondary shadow-none'
                                    }`}
                                >
                                    <div
                                        className={`w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shadow-inset shrink-0 ${
                                            active
                                                ? 'bg-surface-warm-solid text-primary'
                                                : 'bg-[rgba(255,255,255,0.72)] text-muted'
                                        }`}
                                    >
                                        <Icon size={16} strokeWidth={1.8} />
                                    </div>
                                    <div>
                                        <div className="text-sm font-semibold tracking-[0.12px]">{label}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <div className="p-6 overflow-y-auto">
                    <div className="flex items-start gap-3.5 mb-5">
                        <div className="w-11 h-11 rounded-[14px] bg-surface-warm-solid flex items-center justify-center text-primary shadow-warm shrink-0">
                            <ActiveIcon size={20} strokeWidth={1.9} />
                        </div>
                        <div>
                            <h3 className="text-2xl leading-[1.1] font-semibold text-primary mb-2 tracking-[-0.03em]">
                                {activeConfig.title}
                            </h3>
                            <p className="text-sm text-secondary max-w-140">{activeConfig.description}</p>
                        </div>
                    </div>

                    <div className="grid gap-4">
                        {activeTab === 'roast' && (
                            <>
                                <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
                                    <div className="mb-3.5">
                                        <h4 className="text-base font-semibold text-primary mb-1">Temperature Unit</h4>
                                        <p className="text-[13px] text-secondary">
                                            Display temperatures in Celsius or Fahrenheit.
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {(['C', 'F'] as TemperatureUnit[]).map((u) => {
                                            const active = roastSettings.temperatureUnit === u;
                                            return (
                                                <button
                                                    key={u}
                                                    onClick={() => updateRoastSettings({ temperatureUnit: u })}
                                                    className={`border-none rounded-full px-5 py-2.25 cursor-pointer text-[13px] font-semibold ${
                                                        active
                                                            ? 'bg-primary text-white shadow-card'
                                                            : 'bg-[rgba(255,255,255,0.88)] text-secondary shadow-inset'
                                                    }`}
                                                >
                                                    °{u}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
                                    <div className="mb-3.5">
                                        <h4 className="text-base font-semibold text-primary mb-1">Update Rate</h4>
                                        <p className="text-[13px] text-secondary">
                                            How often to poll the machine for temperature data during a live session.
                                        </p>
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        {([250, 500, 1000] as PollIntervalMs[]).map((ms) => {
                                            const active = roastSettings.pollIntervalMs === ms;
                                            const label = ms < 1000 ? `${ms}ms` : `${ms / 1000}s`;
                                            return (
                                                <button
                                                    key={ms}
                                                    onClick={() => updateRoastSettings({ pollIntervalMs: ms })}
                                                    className={`border-none rounded-full px-4 py-2.25 cursor-pointer text-[13px] font-semibold ${
                                                        active
                                                            ? 'bg-primary text-white shadow-card'
                                                            : 'bg-[rgba(255,255,255,0.88)] text-secondary shadow-inset'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
                                    <div className="mb-3.5">
                                        <h4 className="text-base font-semibold text-primary mb-1">RoR Span</h4>
                                        <p className="text-[13px] text-secondary">
                                            Time window for Rate of Rise calculation. Shorter spans react faster; longer
                                            spans are smoother.
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {([15, 30, 60] as RorSpanSec[]).map((sec) => {
                                            const active = roastSettings.rorSpanSec === sec;
                                            return (
                                                <button
                                                    key={sec}
                                                    onClick={() => updateRoastSettings({ rorSpanSec: sec })}
                                                    className={`border-none rounded-full px-4 py-2.25 cursor-pointer text-[13px] font-semibold ${
                                                        active
                                                            ? 'bg-primary text-white shadow-card'
                                                            : 'bg-[rgba(255,255,255,0.88)] text-secondary shadow-inset'
                                                    }`}
                                                >
                                                    {sec}s
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
                                    <div className="mb-3.5">
                                        <h4 className="text-base font-semibold text-primary mb-1">Data Visibility</h4>
                                        <p className="text-[13px] text-secondary">
                                            Choose which data series are displayed on the roasting chart.
                                        </p>
                                    </div>
                                    <div className="grid gap-2.5">
                                        {(
                                            [
                                                {
                                                    key: 'showET',
                                                    label: 'Env Temp (ET)',
                                                    description: 'Blue dashed line on the temperature chart',
                                                },
                                                {
                                                    key: 'showTargetCurve',
                                                    label: 'Target Curve',
                                                    description: 'Faded reference line for the target BT profile',
                                                },
                                                {
                                                    key: 'showRoRChart',
                                                    label: 'RoR Chart',
                                                    description: 'Rate of Rise sub-chart below the temperature curve',
                                                },
                                                {
                                                    key: 'showRoRET',
                                                    label: 'ET Rate of Rise',
                                                    description: 'ET RoR line in the RoR sub-chart',
                                                },
                                            ] as const
                                        ).map(({ key, label, description }) => (
                                            <label
                                                key={key}
                                                className="flex items-start gap-3 px-3.5 py-3 rounded-[14px] bg-[rgba(255,255,255,0.88)] shadow-inset cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={roastSettings[key]}
                                                    onChange={(e) => updateRoastSettings({ [key]: e.target.checked })}
                                                    className="accent-[#6f4e37] mt-0.5 shrink-0"
                                                />
                                                <div>
                                                    <div className="text-[13px] font-medium text-primary">{label}</div>
                                                    <div className="text-xs text-muted mt-0.5">{description}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </section>
                            </>
                        )}

                        {activeTab === 'general' && (
                            <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
                                <div className="mb-3.5">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Languages size={16} strokeWidth={1.9} className="text-secondary shrink-0" />
                                        <h4 className="text-base font-semibold text-primary m-0">
                                            {t('settings.tabs.general.language')}
                                        </h4>
                                    </div>
                                    <p className="text-[13px] text-secondary">
                                        {t('settings.tabs.general.languageDescription')}
                                    </p>
                                </div>

                                <div className="flex gap-2 flex-wrap">
                                    {supportedLanguages.map((language) => {
                                        const active = i18n.resolvedLanguage === language;

                                        return (
                                            <button
                                                key={language}
                                                onClick={() => void setLanguage(language)}
                                                className={`border-none rounded-full px-3.5 py-2.25 cursor-pointer text-[13px] font-semibold ${
                                                    active
                                                        ? 'bg-primary text-white shadow-card'
                                                        : 'bg-[rgba(255,255,255,0.88)] text-secondary shadow-inset'
                                                }`}
                                            >
                                                {t(`language.${language}`)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {activeConfig.cards.map((card) => (
                            <section
                                key={card.title}
                                className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm"
                            >
                                <div className="mb-3.5">
                                    <h4 className="text-base font-semibold text-primary mb-1">{card.title}</h4>
                                    <p className="text-[13px] text-secondary">{card.description}</p>
                                </div>

                                <div className="grid gap-2.5">
                                    {card.items.map((item) => (
                                        <label
                                            key={item}
                                            className="flex items-center gap-3 px-3.5 py-3 rounded-[14px] bg-[rgba(255,255,255,0.88)] shadow-inset text-secondary text-[13px]"
                                        >
                                            <input type="checkbox" defaultChecked className="accent-[#6f4e37]" />
                                            <span>{item}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
            </div>
        </ModalShell>
    );
};
