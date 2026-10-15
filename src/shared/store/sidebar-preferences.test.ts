// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

import {
    getSidebarPreferences,
    moveSidebarItem,
    normalizeSidebarPreferences,
    resetSidebarOrder,
    SIDEBAR_GROUPS,
    setSidebarCollapsed,
    setSidebarItemHidden,
} from './sidebar-preferences';

const roasting = ['roast', 'history', 'profiles', 'machines', 'cupping'] as const;
const operations = ['dashboard', 'schedule', 'beans', 'orders', 'pricing'] as const;
const defaults = [...operations, ...roasting];

describe('normalizeSidebarPreferences', () => {
    it('drops duplicates and unknown ids, then appends missing items in group order', () => {
        expect(
            normalizeSidebarPreferences({
                collapsed: false,
                fontSize: 17,
                order: ['roast', 'roast', 'ghost', 'history', 'orders', 'settings', 'beans', 'orders'],
            }),
        ).toEqual({
            collapsed: false,
            hidden: [],
            order: [
                'orders',
                'beans',
                'dashboard',
                'schedule',
                'pricing',
                'roast',
                'history',
                'profiles',
                'machines',
                'cupping',
            ],
        });
    });

    it('keeps a scrambled id inside its own group', () => {
        expect(
            normalizeSidebarPreferences({
                order: ['pricing', 'cupping', 'dashboard', 'roast', 'cupping'],
            }).order,
        ).toEqual([
            'pricing',
            'dashboard',
            'schedule',
            'beans',
            'orders',
            'cupping',
            'roast',
            'history',
            'profiles',
            'machines',
        ]);
    });

    it('uses the expanded default when the saved value is unusable', () => {
        expect(normalizeSidebarPreferences(null)).toEqual({ collapsed: false, hidden: [], order: defaults });
        expect(normalizeSidebarPreferences({ collapsed: 'true', order: { roast: 1 } })).toEqual({
            collapsed: false,
            hidden: [],
            order: defaults,
        });
        expect(normalizeSidebarPreferences({ collapsed: true }).collapsed).toBe(true);
    });

    it('drops unknown and duplicate hidden ids and keeps them in menu order', () => {
        expect(
            normalizeSidebarPreferences({
                hidden: ['orders', 'ghost', 'orders', 'cupping', 'settings'],
                order: ['history', 'roast'],
            }).hidden,
        ).toEqual(['orders', 'cupping']);
    });

    it('does not carry fontSize', () => {
        const normalized = normalizeSidebarPreferences({ fontSize: 15, collapsed: false, order: defaults });
        expect(normalized).toEqual({ collapsed: false, hidden: [], order: defaults });
        expect(Object.keys(normalized)).toEqual(['collapsed', 'order', 'hidden']);
    });
});

describe('sidebar order edits', () => {
    beforeEach(() => {
        resetSidebarOrder();
        setSidebarCollapsed(false);
    });

    it('moves one step inside the group and leaves collapse alone on reset', () => {
        setSidebarCollapsed(true);
        moveSidebarItem('roast', -1);
        expect(getSidebarPreferences().order).toEqual(defaults);

        moveSidebarItem('history', -1);
        expect(getSidebarPreferences().order.slice(0, 5)).toEqual([...operations]);
        expect(getSidebarPreferences().order.slice(5, 7)).toEqual(['history', 'roast']);

        moveSidebarItem('cupping', 1);
        expect(getSidebarPreferences().order.at(-1)).toBe('cupping');

        setSidebarItemHidden('cupping', true);
        setSidebarItemHidden('orders', true);
        expect(getSidebarPreferences().hidden).toEqual(['orders', 'cupping']);
        setSidebarItemHidden('cupping', false);

        resetSidebarOrder();
        expect(getSidebarPreferences()).toEqual({ collapsed: true, hidden: [], order: defaults });
        expect(SIDEBAR_GROUPS.map((group) => group.labelKey)).toEqual([
            'sidebar.groups.operations',
            'sidebar.groups.roasting',
        ]);
    });

    it('keeps the browser copy when the device store has no entry', async () => {
        vi.resetModules();
        localStorage.setItem('fc_sidebar.settings', JSON.stringify({ collapsed: true, order: ['history', 'roast'] }));
        const { settingsGet } = await import('@shared/lib/settings-store');
        vi.mocked(settingsGet).mockResolvedValueOnce(null);
        const { getSidebarPreferences: read } = await import('./sidebar-preferences');
        await Promise.resolve();
        expect(read().collapsed).toBe(true);
        const order = read().order;
        expect(order.indexOf('history')).toBeLessThan(order.indexOf('roast'));
    });
});
