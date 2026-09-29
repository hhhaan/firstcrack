// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryTable } from './HistoryTable';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@widgets/profile-curve-chart/ui/ProfileCurveChart', () => ({
    COMPARE_COLORS: ['var(--color-palette-blue)'],
}));
vi.mock('./OutputWeightEditor', () => ({ OutputWeightEditor: () => null }));
vi.mock('./SessionScorecard', () => ({ SessionScorecard: () => null }));
vi.mock('./HistorySessionChart', () => ({ HistorySessionChart: () => null }));
vi.mock('../hooks/useRoastRecordSave', () => ({
    useRoastRecordSave: () => ({
        canWrite: true,
        isPending: false,
        saveEvents: vi.fn(),
        saveHeater: vi.fn(),
        errorText: () => 'failed',
    }),
}));
vi.mock('@entities/roast', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/roast')>();
    return {
        ...actual,
        useHistoryChart: () => ({ points: [], isLoading: false, isError: false }),
    };
});

const session = (index: number): RoastSessionWithRelations =>
    ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        user_id: 'owner',
        roasted_at: '2026-01-15T00:00:00.000Z',
        beans: { name: `Bean ${index}`, origin: 'Ethiopia', region: null, variety: null, process: null, farm: null },
        roast_profiles: null,
        weight_grams: 1000,
        output_weight_grams: null,
        drop_temp_celsius: 210,
        duration_seconds: 600,
        roast_level: 'Medium',
        events: [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210 },
        ],
        heater_events: null,
        notes: null,
        tsv_path: null,
        status: 'completed',
        charge_temp_celsius: 200,
        bean_label: null,
        profile_id: null,
    }) as unknown as RoastSessionWithRelations;

describe('HistoryTable edit dialog', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
    });

    it('mounts the edit dialog on document.body when many rows sit in the container', async () => {
        const sessions = Array.from({ length: 40 }, (_, index) => session(index));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(
                createElement(HistoryTable, {
                    sessions,
                    total: sessions.length,
                    filteredTotal: sessions.length,
                    expandedId: sessions[sessions.length - 1].id,
                    compareMode: false,
                    compareIds: [],
                    onRowClick: () => {},
                    onDeleteClick: () => {},
                    onSaveAsProfile: () => {},
                    sortKey: 'date',
                    sortAsc: false,
                    onSort: () => {},
                    page: 1,
                    totalPages: 1,
                    pageSize: 50,
                    onPageChange: () => {},
                }),
            );
        });

        const container = host.firstElementChild as HTMLElement;
        expect(container.className).toContain('@container');
        expect(container.querySelectorAll('tbody > tr').length).toBeGreaterThan(40);

        const edit = container.querySelector('[data-testid="history-edit-events"]') as HTMLButtonElement;
        await act(async () => {
            edit.click();
        });

        const dialog = document.querySelector('[data-testid="record-events-editor"]');
        const overlay = dialog?.parentElement;
        expect(overlay?.getAttribute('role')).toBe('presentation');
        expect(overlay?.className).toContain('fixed');
        expect(overlay?.className).toContain('inset-0');
        expect(overlay?.parentElement).toBe(document.body);
        expect(container.contains(dialog)).toBe(false);
    });
});
