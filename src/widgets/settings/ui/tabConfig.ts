import type { TFunction } from 'i18next';
import { CreditCard, Flame, Info, LayoutDashboard, LifeBuoy, type LucideIcon, User, Users } from 'lucide-react';

export type SettingsTabId = 'general' | 'roast' | 'account' | 'billing' | 'team' | 'software' | 'support';

export interface TabConfig {
    id: SettingsTabId;
    label: string;
    icon: LucideIcon;
    title: string;
    description: string;
}

function searchText(value: unknown): string {
    if (typeof value === 'string') return value;
    return value && typeof value === 'object' ? Object.values(value).map(searchText).join(' ') : '';
}

export function getSearchTabs(t: TFunction, query: string) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return getTabs(t).filter((tab) => {
        const text = searchText(t(`settings.tabs.${tab.id}`, { returnObjects: true })).toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
    });
}

export const getTabs = (t: (key: string) => string): TabConfig[] => {
    const tk = (tab: SettingsTabId, key: string) => t(`settings.tabs.${tab}.${key}`);

    // Order: frequent prefs → product domain → identity/billing → meta → help
    // Team is always visible: redeem/join must work on any plan; invite-create is gated in-tab.
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
            id: 'team',
            label: tk('team', 'label'),
            icon: Users,
            title: tk('team', 'title'),
            description: tk('team', 'description'),
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
