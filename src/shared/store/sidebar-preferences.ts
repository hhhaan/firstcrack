import { createDevicePreference } from '@shared/lib/device-preference';

export const SIDEBAR_GROUPS = [
    { labelKey: 'sidebar.groups.roasting', ids: ['roast', 'history', 'profiles', 'machines', 'cupping'] },
    { labelKey: 'sidebar.groups.operations', ids: ['dashboard', 'schedule', 'beans', 'orders', 'pricing'] },
] as const;

export type SidebarNavId = (typeof SIDEBAR_GROUPS)[number]['ids'][number];

const GROUP_INDEX = new Map<string, number>(
    SIDEBAR_GROUPS.flatMap((group, index) => group.ids.map((id) => [id, index] as const)),
);

const DEFAULT_ORDER: SidebarNavId[] = SIDEBAR_GROUPS.flatMap((group) => [...group.ids]);

type SidebarPreferences = { collapsed: boolean; order: SidebarNavId[] };

const isNavId = (id: string): id is SidebarNavId => GROUP_INDEX.has(id);

/** Drop unknown ids and duplicates. Missing defaults are appended in each group's default order. */
export const normalizeSidebarPreferences = (raw: unknown): SidebarPreferences => {
    const data = raw !== null && typeof raw === 'object' ? (raw as { collapsed?: unknown; order?: unknown }) : {};
    const seen = new Set<SidebarNavId>();
    const kept: SidebarNavId[] = [];
    if (Array.isArray(data.order)) {
        for (const id of data.order) {
            if (typeof id !== 'string' || !isNavId(id) || seen.has(id)) continue;
            seen.add(id);
            kept.push(id);
        }
    }
    const byGroup = SIDEBAR_GROUPS.map(() => [] as SidebarNavId[]);
    for (const id of kept) {
        const index = GROUP_INDEX.get(id);
        if (index !== undefined) byGroup[index]?.push(id);
    }
    const order = SIDEBAR_GROUPS.flatMap((group, index) => [
        ...(byGroup[index] ?? []),
        ...group.ids.filter((id) => !byGroup[index]?.includes(id)),
    ]);
    return { collapsed: data.collapsed === true, order };
};

const preference = createDevicePreference(
    'sidebar.settings',
    { collapsed: false, order: DEFAULT_ORDER },
    normalizeSidebarPreferences,
);

export const useSidebarPreferences = preference.useValue;
export const getSidebarPreferences = () => preference.get();

export const setSidebarCollapsed = (collapsed: boolean | ((previous: boolean) => boolean)) => {
    const current = preference.get();
    preference.update({
        ...current,
        collapsed: typeof collapsed === 'function' ? collapsed(current.collapsed) : collapsed,
    });
};

export const moveSidebarItem = (id: SidebarNavId, delta: -1 | 1) => {
    const current = preference.get();
    const groupIndex = GROUP_INDEX.get(id);
    if (groupIndex === undefined) return;
    const ids = current.order.filter((item) => GROUP_INDEX.get(item) === groupIndex);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    let cursor = 0;
    const order = current.order.map((item) => (GROUP_INDEX.get(item) === groupIndex ? next[cursor++] : item));
    preference.update({ ...current, order });
};

export const resetSidebarOrder = () => {
    const current = preference.get();
    preference.update({ ...current, order: [...DEFAULT_ORDER] });
};
