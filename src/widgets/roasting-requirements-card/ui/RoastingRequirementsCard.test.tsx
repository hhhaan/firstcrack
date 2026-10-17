// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoastingRequirementsCard } from './RoastingRequirementsCard';

const BEAN = 'bean-1';

const requirements = vi.hoisted(() => ({ current: { products: [], beans: [] } as unknown }));

vi.mock('@entities/bean', () => ({
    useBeans: () => ({ data: [{ id: BEAN, name: 'Ethiopia' }] }),
}));

vi.mock('@entities/order', () => ({
    useRoastingRequirements: () => ({ data: requirements.current, isLoading: false }),
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1' }),
}));

vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({
        data: [
            { id: 'p1', name: 'Light' },
            { id: 'p2', name: 'Dark' },
        ],
    }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { name?: string; amount?: string; bean?: string }) => {
            if (key === 'orders.requirements.profileAmount') {
                return `${opts?.name} · ${opts?.amount} kg`;
            }
            if (key === 'orders.requirements.expandBreakdown') return `Expand ${opts?.bean}`;
            if (key === 'orders.requirements.collapseBreakdown') return `Collapse ${opts?.bean}`;
            return key;
        },
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (roastProfileId: string, needed: number, available: number) => ({
    bean_id: BEAN,
    roast_profile_id: roastProfileId,
    roasted_grams_needed: 0,
    green_grams_needed: needed,
    green_available: available,
});

const render = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(RoastingRequirementsCard)));
    return { host, root };
};

afterEach(() => {
    requirements.current = { products: [], beans: [] };
    document.body.replaceChildren();
});

describe('RoastingRequirementsCard', () => {
    it('sums the shortfall across profiles and compares it to the single stock', () => {
        requirements.current = { products: [], beans: [row('p1', 4000, 5000), row('p2', 4000, 5000)] };
        const { host, root } = render();

        const mainRow = host.querySelector('tbody tr');
        const cells = [...(mainRow?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
        expect(cells[0]).toContain('Ethiopia');
        expect(cells[1]).toBe('8.00 kg');
        expect(cells[2]).toBe('5.00 kg');
        expect(host.querySelector('td:last-child')?.className).toContain('text-red-500');

        act(() => root.unmount());
    });

    it('shows per-profile breakdown after expanding the bean row', () => {
        requirements.current = { products: [], beans: [row('p1', 4000, 5000), row('p2', 4000, 5000)] };
        const { host, root } = render();

        const toggle = host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement;
        expect(toggle).toBeTruthy();
        expect(host.textContent).not.toContain('Light · 4.00 kg');

        act(() => {
            toggle.click();
        });

        expect(host.querySelector('button[aria-expanded="true"]')).toBeTruthy();
        expect(host.textContent).toContain('Light · 4.00 kg');
        expect(host.textContent).toContain('Dark · 4.00 kg');

        act(() => root.unmount());
    });

    it('keeps the default color when the single need fits the stock', () => {
        requirements.current = { products: [], beans: [row('p1', 4000, 5000)] };
        const { host, root } = render();

        const available = host.querySelector('td:last-child');
        expect(available?.textContent).toBe('5.00 kg');
        expect(available?.className).not.toContain('text-red-500');
        expect(host.textContent).toContain('Light · 4.00 kg');

        act(() => root.unmount());
    });
});
