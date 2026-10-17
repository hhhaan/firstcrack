// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
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

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
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
    const root = createRoot(host);
    act(() => root.render(createElement(RoastingRequirementsCard)));
    return { host, root };
};

afterEach(() => {
    requirements.current = { products: [], beans: [] };
    document.body.replaceChildren();
});

it('sums the shortfall across profiles and compares it to the single stock', () => {
    requirements.current = { products: [], beans: [row('p1', 4000, 5000), row('p2', 4000, 5000)] };
    const { host, root } = render();

    const cells = [...host.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(cells).toEqual([['Ethiopia', '8.00 kg', '5.00 kg']]);
    expect(host.querySelector('td:last-child')?.className).toContain('text-red-500');

    act(() => root.unmount());
});

it('keeps the default color when the single need fits the stock', () => {
    requirements.current = { products: [], beans: [row('p1', 4000, 5000)] };
    const { host, root } = render();

    const available = host.querySelector('td:last-child');
    expect(available?.textContent).toBe('5.00 kg');
    expect(available?.className).not.toContain('text-red-500');

    act(() => root.unmount());
});
