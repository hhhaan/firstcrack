// @vitest-environment jsdom
import type { Bean } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeanDetail } from './BeanDetail';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPT = 'opt_11111111-1111-4111-8111-111111111111';

const bean = (): Bean =>
    ({
        id: OPT,
        user_id: 'user-1',
        name: 'Saving lot',
        capacity_grams: 5000,
        low_stock_threshold_grams: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        altitude_masl: null,
        cost_per_kg: null,
        farm: null,
        origin: null,
        process: null,
        purchase_date: null,
        region: null,
        tasting_notes: null,
        variety: null,
        vendor: null,
    }) satisfies Bean;

describe('BeanDetail optimistic bean', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('disables edit, delete, restock, and start roast until the server uuid lands', () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        act(() => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(BeanDetail, {
                        bean: bean(),
                        hasAny: true,
                        isLoading: false,
                        affectedBlendNames: [],
                        onEdit: vi.fn(),
                        onRestock: vi.fn(),
                        onStartRoast: vi.fn(),
                        onDelete: vi.fn(),
                    }),
                ),
            );
        });
        const buttons = host.querySelectorAll('button');
        const startRoast = [...buttons].find((b) => b.textContent === 'beanDetail.startRoast');
        const restock = [...buttons].find((b) => b.textContent === 'beanDetail.restock');
        expect(startRoast?.disabled).toBe(true);
        expect(restock?.disabled).toBe(true);
        const iconButtons = host.querySelectorAll('button[disabled]');
        expect(iconButtons.length).toBeGreaterThanOrEqual(2);
    });
});
