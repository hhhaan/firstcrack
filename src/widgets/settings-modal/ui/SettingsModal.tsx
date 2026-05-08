import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bell, Database, Flame, Languages, LayoutDashboard, PlayCircle, Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../../../shared/ui/modal-shell/ModalShell';
import { setLanguage, supportedLanguages } from '../../../shared/i18n';
import {
    useRoastSettings,
    updateRoastSettings,
    type PollIntervalMs,
    type RorSpanSec,
    type TemperatureUnit,
} from '../../../shared/store/roastSettings';

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

const tabButtonStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '12px 14px',
    borderRadius: 14,
    border: 'none',
    cursor: 'pointer',
    background: active ? 'rgba(255,255,255,0.96)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--color-secondary)',
    boxShadow: active ? 'var(--shadow-card)' : 'none',
    textAlign: 'left',
    transition: 'all 0.18s ease',
});

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
            contentStyle={{
                width: 'min(920px, 100%)',
                maxHeight: 'min(780px, calc(100vh - 48px))',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 24,
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 24px 60px rgba(22, 18, 12, 0.2)',
                border: '1px solid rgba(0,0,0,0.08)',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '28px 28px 20px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    background: 'linear-gradient(180deg, rgba(248,245,240,0.72) 0%, rgba(255,255,255,0.92) 100%)',
                }}
            >
                <div>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            borderRadius: 999,
                            background: 'var(--color-surface-warm-solid)',
                            color: 'var(--color-secondary)',
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: '0.12px',
                            marginBottom: 14,
                        }}
                    >
                        <Shield size={14} strokeWidth={1.8} />
                        {t('settings.title')}
                    </div>
                    <h2 id="settings-modal-title" style={{ margin: 0, fontSize: 0, lineHeight: 0 }}>
                        {t('settings.title')}
                    </h2>
                </div>

                <button
                    onClick={onClose}
                    aria-label={t('settings.close')}
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        border: 'none',
                        background: 'var(--color-surface)',
                        color: 'var(--color-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        boxShadow: 'var(--shadow-inset)',
                    }}
                >
                    <X size={16} strokeWidth={1.9} />
                </button>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '240px minmax(0, 1fr)',
                    minHeight: 0,
                    flex: 1,
                }}
            >
                <aside
                    style={{
                        padding: 20,
                        borderRight: '1px solid var(--color-border-subtle)',
                        background: 'rgba(247,244,240,0.64)',
                        overflowY: 'auto',
                    }}
                >
                    <div
                        style={{
                            display: 'grid',
                            gap: 8,
                            padding: 6,
                            borderRadius: 20,
                            background: 'rgba(255,255,255,0.55)',
                            boxShadow: 'var(--shadow-inset)',
                        }}
                    >
                        {tabs.map(({ id, label, icon: Icon }) => {
                            const active = id === activeTab;

                            return (
                                <button key={id} onClick={() => setActiveTab(id)} style={tabButtonStyle(active)}>
                                    <div
                                        style={{
                                            width: 34,
                                            height: 34,
                                            borderRadius: 10,
                                            background: active
                                                ? 'var(--color-surface-warm-solid)'
                                                : 'rgba(255,255,255,0.72)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: active ? 'var(--color-primary)' : 'var(--color-muted)',
                                            boxShadow: 'var(--shadow-inset)',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <Icon size={16} strokeWidth={1.8} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.12px' }}>
                                            {label}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <div
                    style={{
                        padding: 24,
                        overflowY: 'auto',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 14,
                            marginBottom: 20,
                        }}
                    >
                        <div
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 14,
                                background: 'var(--color-surface-warm-solid)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--color-primary)',
                                boxShadow: 'var(--shadow-warm)',
                                flexShrink: 0,
                            }}
                        >
                            <ActiveIcon size={20} strokeWidth={1.9} />
                        </div>
                        <div>
                            <h3
                                style={{
                                    fontSize: 24,
                                    lineHeight: 1.1,
                                    fontWeight: 600,
                                    color: 'var(--color-primary)',
                                    marginBottom: 8,
                                    letterSpacing: '-0.03em',
                                }}
                            >
                                {activeConfig.title}
                            </h3>
                            <p style={{ fontSize: 14, color: 'var(--color-secondary)', maxWidth: 560 }}>
                                {activeConfig.description}
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: 16 }}>
                        {activeTab === 'roast' && (
                            <>
                                {/* Temperature Unit */}
                                <section
                                    style={{
                                        borderRadius: 20,
                                        padding: 20,
                                        background:
                                            'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        boxShadow: 'var(--shadow-warm)',
                                    }}
                                >
                                    <div style={{ marginBottom: 14 }}>
                                        <h4
                                            style={{
                                                fontSize: 16,
                                                fontWeight: 600,
                                                color: 'var(--color-primary)',
                                                marginBottom: 4,
                                            }}
                                        >
                                            Temperature Unit
                                        </h4>
                                        <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>
                                            Display temperatures in Celsius or Fahrenheit.
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {(['C', 'F'] as TemperatureUnit[]).map((u) => {
                                            const active = roastSettings.temperatureUnit === u;
                                            return (
                                                <button
                                                    key={u}
                                                    onClick={() => updateRoastSettings({ temperatureUnit: u })}
                                                    style={{
                                                        border: 'none',
                                                        borderRadius: 9999,
                                                        padding: '9px 20px',
                                                        cursor: 'pointer',
                                                        background: active
                                                            ? 'var(--color-primary)'
                                                            : 'rgba(255,255,255,0.88)',
                                                        color: active ? '#fff' : 'var(--color-secondary)',
                                                        fontSize: 13,
                                                        fontWeight: 600,
                                                        boxShadow: active
                                                            ? 'var(--shadow-card)'
                                                            : 'var(--shadow-inset)',
                                                    }}
                                                >
                                                    °{u}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                {/* Update Rate */}
                                <section
                                    style={{
                                        borderRadius: 20,
                                        padding: 20,
                                        background:
                                            'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        boxShadow: 'var(--shadow-warm)',
                                    }}
                                >
                                    <div style={{ marginBottom: 14 }}>
                                        <h4
                                            style={{
                                                fontSize: 16,
                                                fontWeight: 600,
                                                color: 'var(--color-primary)',
                                                marginBottom: 4,
                                            }}
                                        >
                                            Update Rate
                                        </h4>
                                        <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>
                                            How often to poll the machine for temperature data during a live session.
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {([250, 500, 1000] as PollIntervalMs[]).map((ms) => {
                                            const active = roastSettings.pollIntervalMs === ms;
                                            const label = ms < 1000 ? `${ms}ms` : `${ms / 1000}s`;
                                            return (
                                                <button
                                                    key={ms}
                                                    onClick={() => updateRoastSettings({ pollIntervalMs: ms })}
                                                    style={{
                                                        border: 'none',
                                                        borderRadius: 9999,
                                                        padding: '9px 16px',
                                                        cursor: 'pointer',
                                                        background: active
                                                            ? 'var(--color-primary)'
                                                            : 'rgba(255,255,255,0.88)',
                                                        color: active ? '#fff' : 'var(--color-secondary)',
                                                        fontSize: 13,
                                                        fontWeight: 600,
                                                        boxShadow: active
                                                            ? 'var(--shadow-card)'
                                                            : 'var(--shadow-inset)',
                                                    }}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                {/* RoR Span */}
                                <section
                                    style={{
                                        borderRadius: 20,
                                        padding: 20,
                                        background:
                                            'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        boxShadow: 'var(--shadow-warm)',
                                    }}
                                >
                                    <div style={{ marginBottom: 14 }}>
                                        <h4
                                            style={{
                                                fontSize: 16,
                                                fontWeight: 600,
                                                color: 'var(--color-primary)',
                                                marginBottom: 4,
                                            }}
                                        >
                                            RoR Span
                                        </h4>
                                        <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>
                                            Time window for Rate of Rise calculation. Shorter spans react faster; longer
                                            spans are smoother.
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {([15, 30, 60] as RorSpanSec[]).map((sec) => {
                                            const active = roastSettings.rorSpanSec === sec;
                                            return (
                                                <button
                                                    key={sec}
                                                    onClick={() => updateRoastSettings({ rorSpanSec: sec })}
                                                    style={{
                                                        border: 'none',
                                                        borderRadius: 9999,
                                                        padding: '9px 16px',
                                                        cursor: 'pointer',
                                                        background: active
                                                            ? 'var(--color-primary)'
                                                            : 'rgba(255,255,255,0.88)',
                                                        color: active ? '#fff' : 'var(--color-secondary)',
                                                        fontSize: 13,
                                                        fontWeight: 600,
                                                        boxShadow: active
                                                            ? 'var(--shadow-card)'
                                                            : 'var(--shadow-inset)',
                                                    }}
                                                >
                                                    {sec}s
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                {/* Data Visibility */}
                                <section
                                    style={{
                                        borderRadius: 20,
                                        padding: 20,
                                        background:
                                            'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        boxShadow: 'var(--shadow-warm)',
                                    }}
                                >
                                    <div style={{ marginBottom: 14 }}>
                                        <h4
                                            style={{
                                                fontSize: 16,
                                                fontWeight: 600,
                                                color: 'var(--color-primary)',
                                                marginBottom: 4,
                                            }}
                                        >
                                            Data Visibility
                                        </h4>
                                        <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>
                                            Choose which data series are displayed on the roasting chart.
                                        </p>
                                    </div>
                                    <div style={{ display: 'grid', gap: 10 }}>
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
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    gap: 12,
                                                    padding: '12px 14px',
                                                    borderRadius: 14,
                                                    background: 'rgba(255,255,255,0.88)',
                                                    boxShadow: 'var(--shadow-inset)',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={roastSettings[key]}
                                                    onChange={(e) => updateRoastSettings({ [key]: e.target.checked })}
                                                    style={{ accentColor: '#6f4e37', marginTop: 2, flexShrink: 0 }}
                                                />
                                                <div>
                                                    <div
                                                        style={{
                                                            fontSize: 13,
                                                            fontWeight: 500,
                                                            color: 'var(--color-primary)',
                                                        }}
                                                    >
                                                        {label}
                                                    </div>
                                                    <div
                                                        style={{
                                                            fontSize: 12,
                                                            color: 'var(--color-muted)',
                                                            marginTop: 2,
                                                        }}
                                                    >
                                                        {description}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </section>
                            </>
                        )}

                        {activeTab === 'general' && (
                            <section
                                style={{
                                    borderRadius: 20,
                                    padding: 20,
                                    background:
                                        'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    boxShadow: 'var(--shadow-warm)',
                                }}
                            >
                                <div style={{ marginBottom: 14 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <Languages size={16} strokeWidth={1.9} color="var(--color-secondary)" />
                                        <h4
                                            style={{
                                                fontSize: 16,
                                                fontWeight: 600,
                                                color: 'var(--color-primary)',
                                                margin: 0,
                                            }}
                                        >
                                            {t('settings.tabs.general.language')}
                                        </h4>
                                    </div>
                                    <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>
                                        {t('settings.tabs.general.languageDescription')}
                                    </p>
                                </div>

                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {supportedLanguages.map((language) => {
                                        const active = i18n.resolvedLanguage === language;

                                        return (
                                            <button
                                                key={language}
                                                onClick={() => void setLanguage(language)}
                                                style={{
                                                    border: 'none',
                                                    borderRadius: 9999,
                                                    padding: '9px 14px',
                                                    cursor: 'pointer',
                                                    background: active
                                                        ? 'var(--color-primary)'
                                                        : 'rgba(255,255,255,0.88)',
                                                    color: active ? '#fff' : 'var(--color-secondary)',
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    boxShadow: active ? 'var(--shadow-card)' : 'var(--shadow-inset)',
                                                }}
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
                                style={{
                                    borderRadius: 20,
                                    padding: 20,
                                    background:
                                        'linear-gradient(180deg, rgba(245,242,239,0.75) 0%, rgba(255,255,255,0.92) 100%)',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    boxShadow: 'var(--shadow-warm)',
                                }}
                            >
                                <div style={{ marginBottom: 14 }}>
                                    <h4
                                        style={{
                                            fontSize: 16,
                                            fontWeight: 600,
                                            color: 'var(--color-primary)',
                                            marginBottom: 4,
                                        }}
                                    >
                                        {card.title}
                                    </h4>
                                    <p style={{ fontSize: 13, color: 'var(--color-secondary)' }}>{card.description}</p>
                                </div>

                                <div style={{ display: 'grid', gap: 10 }}>
                                    {card.items.map((item) => (
                                        <label
                                            key={item}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                padding: '12px 14px',
                                                borderRadius: 14,
                                                background: 'rgba(255,255,255,0.88)',
                                                boxShadow: 'var(--shadow-inset)',
                                                color: 'var(--color-secondary)',
                                                fontSize: 13,
                                            }}
                                        >
                                            <input type="checkbox" defaultChecked style={{ accentColor: '#6f4e37' }} />
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
