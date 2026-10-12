import { createDevicePreference } from '@shared/lib/device-preference';
import type { View } from '@shared/types/view';

export const SIDEBAR_GROUPS: { label: string; ids: View[] }[] = [
    { label: 'sidebar.groups.roasting', ids: ['roast', 'history', 'profiles', 'machines', 'cupping'] },
    { label: 'sidebar.groups.business', ids: ['dashboard', 'schedule', 'beans', 'orders', 'pricing'] },
];
type SidebarPreferences = { collapsed: boolean; fontSize: number; order: View[] };
export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
    collapsed: false,
    fontSize: 13,
    order: SIDEBAR_GROUPS.flatMap((group) => group.ids),
};
export const normalizeSidebarPreferences = (raw: unknown): SidebarPreferences => {
    const data = raw && typeof raw === 'object' ? (raw as Partial<SidebarPreferences>) : {};
    const valid = DEFAULT_SIDEBAR_PREFERENCES.order;
    const order = Array.isArray(data.order) ? [...new Set(data.order.filter((id) => valid.includes(id)))] : [];
    return {
        collapsed: data.collapsed === true,
        fontSize: [13, 15, 17].includes(data.fontSize ?? 0) ? (data.fontSize as number) : 13,
        order: [...order, ...valid.filter((id) => !order.includes(id))],
    };
};
const preference = createDevicePreference('sidebar.settings', DEFAULT_SIDEBAR_PREFERENCES, normalizeSidebarPreferences);
export const useSidebarPreferences = preference.useValue;
export const setSidebarCollapsed = (collapsed: boolean | ((previous: boolean) => boolean)) => {
    const current = preference.get();
    preference.update({
        ...current,
        collapsed: typeof collapsed === 'function' ? collapsed(current.collapsed) : collapsed,
    });
};
export const updateSidebarPreferences = (patch: Partial<SidebarPreferences>) =>
    preference.update({ ...preference.get(), ...patch });
