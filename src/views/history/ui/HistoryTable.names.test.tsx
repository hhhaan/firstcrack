// @vitest-environment jsdom
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HistoryTable } from './HistoryTable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn(async () => null),
    settingsSet: vi.fn(async () => undefined),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the roast title, linked green bean and profile in distinct cells without reinterpreting unlinked names', () => {
    const linked = {
        id: 'linked',
        batch_name: 'Batch C',
        profile_batch_number: 9,
        total_batch_number: 13,
        bean_label: null,
        beans: { name: 'Green B' },
        roast_profiles: { name: 'Profile A' },
        roasted_at: '2026-10-19T14:35:47',
        weight_grams: 1000,
        duration_seconds: 600,
        drop_temp_celsius: 200,
        events: [],
        roast_level: null,
        color_whole: '58.4, 59.6',
        color_ground: '63',
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
                        {
                            ...linked,
                            id: 'unlinked',
                            batch_name: null,
                            beans: null,
                            bean_label: 'Legacy name',
                            profile_batch_number: null,
                            total_batch_number: null,
                            roasted_at: '2026-10-19T14:36:47',
                            color_whole: null,
                            color_ground: null,
                        },
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
        expect(cells[0]).toBe('26-10-19');
        expect(cells.slice(1, 5)).toEqual(['Batch C', 'Green B', '#9 · Σ#13', 'Profile A']);
        const legacy = [...rows[1].querySelectorAll('td')].map((cell) => cell.textContent);
        expect(legacy[0]).toBe('26-10-19');
        expect(legacy.slice(1, 5)).toEqual(['Legacy name', '—', '—', 'Profile A']);
        const headers = [...host.querySelectorAll('thead th')].map((cell) => cell.textContent);
        const wholeIndex = headers.indexOf('history.expanded.colorWhole');
        const groundIndex = headers.indexOf('history.expanded.colorGround');
        expect(wholeIndex).toBeGreaterThanOrEqual(0);
        expect(groundIndex).toBeGreaterThanOrEqual(0);
        expect(cells[wholeIndex]).toBe('59.00');
        expect(cells[groundIndex]).toBe('63.00');
        expect(rows[0].querySelectorAll('td')[wholeIndex].title).toBe('58.4, 59.6');
        expect(legacy[wholeIndex]).toBe('—');
        expect(legacy[groundIndex]).toBe('—');
        expect(linked.batch_name).toBe('Batch C');
        expect(linked.bean_label).toBeNull();
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
