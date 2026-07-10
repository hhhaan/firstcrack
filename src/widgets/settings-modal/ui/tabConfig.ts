import { CreditCard, Flame, Info, LayoutDashboard, LifeBuoy, type LucideIcon, User } from 'lucide-react';

export type SettingsTabId = 'general' | 'roast' | 'account' | 'billing' | 'software' | 'support';

export interface TabConfig {
    id: SettingsTabId;
    label: string;
    icon: LucideIcon;
    title: string;
    description: string;
}

export const getTabs = (t: (key: string) => string): TabConfig[] => {
    const tk = (tab: SettingsTabId, key: string) => t(`settings.tabs.${tab}.${key}`);

    // Order: frequent prefs → product domain → identity/billing → meta → help
    return [
        {
            id: 'general',
            label: tk('general', 'label'),
            icon: LayoutDashboard,
            title: tk('general', 'title'),
            description: tk('general', 'description'),
        },
        {
            id: 'roast',
            label: tk('roast', 'label'),
            icon: Flame,
            title: tk('roast', 'title'),
            description: tk('roast', 'description'),
        },
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
            id: 'software',
            label: tk('software', 'label'),
            icon: Info,
            title: tk('software', 'title'),
            description: tk('software', 'description'),
        },
        {
            id: 'support',
            label: tk('support', 'label'),
            icon: LifeBuoy,
            title: tk('support', 'title'),
            description: tk('support', 'description'),
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
    ];
};
