import { Bell, Flame, LayoutDashboard, type LucideIcon, PlayCircle, User } from 'lucide-react';

export type SettingsTabId = 'general' | 'notifications' | 'session' | 'roast' | 'account';

export interface TabConfig {
    id: SettingsTabId;
    label: string;
    icon: LucideIcon;
    title: string;
    description: string;
    cards: Array<{
        title: string;
        description: string;
        items: string[];
    }>;
}

export const getTabs = (t: (key: string) => string): TabConfig[] => {
    const tk = (tab: SettingsTabId, key: string) => t(`settings.tabs.${tab}.${key}`);

    return [
        {
            id: 'general',
            label: tk('general', 'label'),
            icon: LayoutDashboard,
            title: tk('general', 'title'),
            description: tk('general', 'description'),
            cards: [
                {
                    title: tk('general', 'interfaceTitle'),
                    description: tk('general', 'interfaceDescription'),
                    items: [
                        tk('general', 'defaultLandingView'),
                        tk('general', 'temperatureUnit'),
                        tk('general', 'weightUnit'),
                    ],
                },
                {
                    title: tk('general', 'displayTitle'),
                    description: tk('general', 'displayDescription'),
                    items: [
                        tk('general', 'expandedSidebar'),
                        tk('general', 'liveMetricsPanel'),
                        tk('general', 'compactDataCards'),
                    ],
                },
            ],
        },
        {
            id: 'notifications',
            label: tk('notifications', 'label'),
            icon: Bell,
            title: tk('notifications', 'title'),
            description: tk('notifications', 'description'),
            cards: [
                {
                    title: tk('notifications', 'operationalTitle'),
                    description: tk('notifications', 'operationalDescription'),
                    items: [
                        tk('notifications', 'milestoneAlerts'),
                        tk('notifications', 'disconnectWarning'),
                        tk('notifications', 'maintenanceReminder'),
                    ],
                },
                {
                    title: tk('notifications', 'deliveryTitle'),
                    description: tk('notifications', 'deliveryDescription'),
                    items: [
                        tk('notifications', 'bannerNotifications'),
                        tk('notifications', 'soundAlerts'),
                        tk('notifications', 'highPriorityOnly'),
                    ],
                },
            ],
        },
        {
            id: 'session',
            label: tk('session', 'label'),
            icon: PlayCircle,
            title: tk('session', 'title'),
            description: tk('session', 'description'),
            cards: [
                {
                    title: tk('session', 'startTitle'),
                    description: tk('session', 'startDescription'),
                    items: [
                        tk('session', 'autoStartTimer'),
                        tk('session', 'openActiveRoast'),
                        tk('session', 'confirmBeforeStart'),
                    ],
                },
                {
                    title: tk('session', 'endTitle'),
                    description: tk('session', 'endDescription'),
                    items: [
                        tk('session', 'showSummary'),
                        tk('session', 'confirmDiscard'),
                        tk('session', 'keepNotesVisible'),
                    ],
                },
            ],
        },
        // {
        //     id: 'system',
        //     label: tk('system', 'label'),
        //     icon: Database,
        //     title: tk('system', 'title'),
        //     description: tk('system', 'description'),
        //     cards: [
        //         {
        //             title: tk('system', 'dataTitle'),
        //             description: tk('system', 'dataDescription'),
        //             items: [
        //                 tk('system', 'exportWorkspace'),
        //                 tk('system', 'backupSnapshot'),
        //                 tk('system', 'preserveLogs'),
        //             ],
        //         },
        //         {
        //             title: tk('system', 'environmentTitle'),
        //             description: tk('system', 'environmentDescription'),
        //             items: [tk('system', 'healthBadge'), tk('system', 'checkServices'), tk('system', 'confirmResets')],
        //         },
        //     ],
        // },
        {
            id: 'roast',
            label: tk('roast', 'label'),
            icon: Flame,
            title: tk('roast', 'title'),
            description: tk('roast', 'description'),
            cards: [],
        },
        {
            id: 'account',
            label: tk('account', 'label'),
            icon: User,
            title: tk('account', 'title'),
            description: tk('account', 'description'),
            cards: [],
        },
    ];
};
