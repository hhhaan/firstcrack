import { createDevicePreference } from '@shared/lib/device-preference';

export const SIDEBAR_GROUPS = [
    { labelKey: 'sidebar.groups.operations', ids: ['dashboard', 'beans', 'orders', 'pricing'] },
    { labelKey: 'sidebar.groups.roasting', ids: ['schedule', 'roast', 'history', 'profiles', 'cupping', 'machines'] },
] as const;

export type SidebarNavId = (typeof SIDEBAR_GROUPS)[number]['ids'][number];

const GROUP_INDEX = new Map<string, number>(
    SIDEBAR_GROUPS.flatMap((group, index) => group.ids.map((id) => [id, index] as const)),
);

const DEFAULT_ORDER: SidebarNavId[] = SIDEBAR_GROUPS.flatMap((group) => [...group.ids]);
const LEGACY_DEFAULT_ORDER = [
    'dashboard',
    'schedule',
    'beans',
    'orders',
    'pricing',
    'roast',
    'history',
    'profiles',
    'machines',
    'cupping',
];

type SidebarPreferences = { collapsed: boolean; order: SidebarNavId[]; hidden: SidebarNavId[] };

const isNavId = (id: string): id is SidebarNavId => GROUP_INDEX.has(id);

const readIds = (value: unknown): SidebarNavId[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<SidebarNavId>();
    const ids: SidebarNavId[] = [];
    for (const id of value) {
        if (typeof id !== 'string' || !isNavId(id) || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
};

/** Drop unknown ids and duplicates. Missing defaults are appended in each group's default order. */
export const normalizeSidebarPreferences = (raw: unknown): SidebarPreferences => {
    const data =
        raw !== null && typeof raw === 'object'
            ? (raw as { collapsed?: unknown; order?: unknown; hidden?: unknown })
            : {};
    const savedOrder = readIds(data.order);
    const kept =
        savedOrder.length === LEGACY_DEFAULT_ORDER.length &&
        savedOrder.every((id, index) => id === LEGACY_DEFAULT_ORDER[index])
            ? DEFAULT_ORDER
            : savedOrder;
    const byGroup = SIDEBAR_GROUPS.map(() => [] as SidebarNavId[]);
    for (const id of kept) {
        const index = GROUP_INDEX.get(id);
        if (index !== undefined) byGroup[index]?.push(id);
    }
    const order = SIDEBAR_GROUPS.flatMap((group, index) => [
        ...(byGroup[index] ?? []),
        ...group.ids.filter((id) => !byGroup[index]?.includes(id)),
    ]);
    const hidden = new Set(readIds(data.hidden));
    return { collapsed: data.collapsed === true, order, hidden: order.filter((id) => hidden.has(id)) };
};

const preference = createDevicePreference(
    'sidebar.settings',
    { collapsed: false, order: DEFAULT_ORDER, hidden: [] },
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

export const setSidebarItemHidden = (id: SidebarNavId, hidden: boolean) => {
    const current = preference.get();
    const next = new Set(current.hidden);
    if (hidden) next.add(id);
    else next.delete(id);
    preference.update({ ...current, hidden: current.order.filter((item) => next.has(item)) });
};

/** Restores menu order and visibility. Collapse stays as the user left it. */
export const resetSidebarOrder = () => {
    const current = preference.get();
    preference.update({ ...current, order: [...DEFAULT_ORDER], hidden: [] });
};
