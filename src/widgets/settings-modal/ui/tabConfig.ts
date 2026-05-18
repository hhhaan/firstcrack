import { Bell, Building2, Database, Flame, LayoutDashboard, PlayCircle, User } from 'lucide-react';

export type SettingsTabId = 'general' | 'notifications' | 'session' | 'system' | 'roast' | 'account' | 'workspace';

export interface TabConfig {
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
}

export const getTabs = (t: (key: string) => string): TabConfig[] => [
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
    {
        id: 'account',
        label: 'Account',
        icon: User,
        title: 'Account',
        description: 'Manage your profile information and account settings.',
        cards: [],
    },
    {
        id: 'workspace',
        label: 'Workspace',
        icon: Building2,
        title: 'Workspace',
        description: 'Configure your workspace name and team settings.',
        cards: [],
    },
];
