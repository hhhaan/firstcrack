// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastingRequirementsCard } from './RoastingRequirementsCard';

const state = vi.hoisted(() => ({
    beans: [{ id: 'bean-1', name: 'Ethiopia' }],
    requirements: {
        products: [],
        beans: [
            {
                bean_id: 'bean-1',
                roast_profile_id: 'p1',
                roasted_grams_needed: 0,
                green_grams_needed: 4000,
                green_available: 5000,
            },
            {
                bean_id: 'bean-1',
                roast_profile_id: 'p2',
                roasted_grams_needed: 0,
                green_grams_needed: 4000,
                green_available: 5000,
            },
        ],
    },
}));

vi.mock('@entities/bean', () => ({
    useBeans: () => ({ data: state.beans }),
}));
vi.mock('@entities/order', () => ({
    useRoastingRequirements: () => ({ data: state.requirements, isLoading: false }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            ({
                'orders.requirements.title': 'Roasting',
                'orders.requirements.bean': 'Bean',
                'orders.requirements.green': 'Green',
                'orders.requirements.available': 'Available',
            })[key] ?? key,
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RoastingRequirementsCard', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let container: HTMLDivElement;

    beforeEach(() => {
        state.requirements = {
            products: [],
            beans: [
                {
                    bean_id: 'bean-1',
                    roast_profile_id: 'p1',
                    roasted_grams_needed: 0,
                    green_grams_needed: 4000,
                    green_available: 5000,
                },
                {
                    bean_id: 'bean-1',
                    roast_profile_id: 'p2',
                    roasted_grams_needed: 0,
                    green_grams_needed: 4000,
                    green_available: 5000,
                },
            ],
        };
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const render = async () => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <RoastingRequirementsCard />
                </QueryClientProvider>,
            );
        });
    };

    it('aggregates to one row with 8.00 kg needed and red available when short', async () => {
        await render();
        const rows = container.querySelectorAll('tbody tr');
        expect(rows).toHaveLength(1);
        expect(container.textContent).toContain('8.00 kg');
        expect(container.textContent).toContain('5.00 kg');
        const availableCell = rows[0].querySelectorAll('td')[2];
        expect(availableCell?.className).toContain('text-red-500');
    });

    it('does not highlight available when aggregated need is below stock', async () => {
        state.requirements = {
            products: [],
            beans: [
                {
                    bean_id: 'bean-1',
                    roast_profile_id: 'p1',
                    roasted_grams_needed: 0,
                    green_grams_needed: 4000,
                    green_available: 5000,
                },
            ],
        };
        await render();
        const availableCell = container.querySelector('tbody tr td:last-child');
        expect(availableCell?.className).not.toContain('text-red-500');
        expect(container.textContent).toContain('4.00 kg');
    });
});
