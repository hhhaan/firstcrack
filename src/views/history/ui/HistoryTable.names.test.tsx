// @vitest-environment jsdom
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HistoryTable } from './HistoryTable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@widgets/profile-curve-chart/ui/ProfileCurveChart', () => ({ COMPARE_COLORS: ['#000'] }));
vi.mock('@shared/lib/settings-store', () => ({ settingsGet: vi.fn(async () => null), settingsSet: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the roast title, linked green bean and profile in distinct cells without reinterpreting unlinked names', () => {
    const linked = {
        id: 'linked',
        batch_name: 'Batch C',
        bean_label: null,
        beans: { name: 'Green B' },
        roast_profiles: { name: 'Profile A' },
        roasted_at: '2026-10-19T00:00:00Z',
        weight_grams: 1000,
        duration_seconds: 600,
        drop_temp_celsius: 200,
        events: [],
        roast_level: null,
    } as unknown as RoastSessionWithRelations;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        act(() =>
            root.render(
                createElement(HistoryTable, {
                    sessions: [
                        linked,
                        { ...linked, id: 'unlinked', batch_name: null, beans: null, bean_label: 'Legacy name' },
                    ],
                    total: 2,
                    filteredTotal: 2,
                    compareMode: false,
                    compareIds: [],
                    onRowClick: vi.fn(),
                    onDeleteClick: vi.fn(),
                    sortKey: 'date',
                    sortAsc: false,
                    onSort: vi.fn(),
                    page: 1,
                    totalPages: 1,
                    pageSize: 10,
                    onPageChange: vi.fn(),
                }),
            ),
        );
        const rows = host.querySelectorAll('tbody tr');
        const cells = [...rows[0].querySelectorAll('td')].map((cell) => cell.textContent);
        expect(cells.slice(1, 4)).toEqual(['Batch C', 'Green B', 'Profile A']);
        const legacy = [...rows[1].querySelectorAll('td')].map((cell) => cell.textContent);
        expect(legacy.slice(1, 4)).toEqual(['Legacy name', '—', 'Profile A']);
        expect(linked.batch_name).toBe('Batch C');
        expect(linked.bean_label).toBeNull();
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
