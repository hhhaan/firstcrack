import { CreditCard, Flame, Info, LayoutDashboard, type LucideIcon, User } from 'lucide-react';

export type SettingsTabId = 'general' | 'roast' | 'account' | 'billing' | 'software';

export interface TabConfig {
    id: SettingsTabId;
    label: string;
    icon: LucideIcon;
    title: string;
    description: string;
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
        },
        /* TODO: notifications 탭 - 기능 구현 시 활성화
        {
            id: 'notifications',
            label: tk('notifications', 'label'),
            icon: Bell,
            title: tk('notifications', 'title'),
            description: tk('notifications', 'description'),
        },
        */
        /* TODO: session 탭 - 기능 구현 시 활성화
        {
            id: 'session',
            label: tk('session', 'label'),
            icon: LayoutDashboard,
            title: tk('session', 'title'),
            description: tk('session', 'description'),
        },
        */
        {
            id: 'account',
            label: tk('account', 'label'),
            icon: User,
            title: tk('account', 'title'),
            description: tk('account', 'description'),
        },
        {
            id: 'billing',
            label: tk('billing', 'label'),
            icon: CreditCard,
            title: tk('billing', 'title'),
            description: tk('billing', 'description'),
        },
        {
            id: 'roast',
            label: tk('roast', 'label'),
            icon: Flame,
            title: tk('roast', 'title'),
            description: tk('roast', 'description'),
        },
        {
            id: 'software',
            label: tk('software', 'label'),
            icon: Info,
            title: tk('software', 'title'),
            description: tk('software', 'description'),
        },
    ];
};
