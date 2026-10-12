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
} from './sidebar-preferences';

const roasting = ['roast', 'history', 'profiles', 'machines', 'cupping'] as const;
const operations = ['dashboard', 'schedule', 'beans', 'orders', 'pricing'] as const;
const defaults = [...roasting, ...operations];

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
            order: [
                'roast',
                'history',
                'profiles',
                'machines',
                'cupping',
                'orders',
                'beans',
                'dashboard',
                'schedule',
                'pricing',
            ],
        });
    });

    it('keeps a scrambled id inside its own group', () => {
        expect(
            normalizeSidebarPreferences({
                order: ['pricing', 'cupping', 'dashboard', 'roast', 'cupping'],
            }).order,
        ).toEqual([
            'cupping',
            'roast',
            'history',
            'profiles',
            'machines',
            'pricing',
            'dashboard',
            'schedule',
            'beans',
            'orders',
        ]);
    });

    it('uses the expanded default when the saved value is unusable', () => {
        expect(normalizeSidebarPreferences(null)).toEqual({ collapsed: false, order: defaults });
        expect(normalizeSidebarPreferences({ collapsed: 'true', order: { roast: 1 } })).toEqual({
            collapsed: false,
            order: defaults,
        });
        expect(normalizeSidebarPreferences({ collapsed: true }).collapsed).toBe(true);
    });

    it('does not carry fontSize', () => {
        const normalized = normalizeSidebarPreferences({ fontSize: 15, collapsed: false, order: defaults });
        expect(normalized).toEqual({ collapsed: false, order: defaults });
        expect(Object.keys(normalized)).toEqual(['collapsed', 'order']);
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
        expect(getSidebarPreferences().order.slice(0, 2)).toEqual(['history', 'roast']);
        expect(getSidebarPreferences().order.slice(5)).toEqual([...operations]);

        moveSidebarItem('cupping', 1);
        expect(getSidebarPreferences().order[4]).toBe('cupping');

        resetSidebarOrder();
        expect(getSidebarPreferences()).toEqual({ collapsed: true, order: defaults });
        expect(SIDEBAR_GROUPS.map((group) => group.labelKey)).toEqual([
            'sidebar.groups.roasting',
            'sidebar.groups.operations',
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
        expect(read().order[0]).toBe('history');
    });
});
