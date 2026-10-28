// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { History } from './History';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAMES = ['Mango', 'Apple', 'Zebra', 'Banana', 'Yam', 'Cherry', 'Xray', 'Date', 'Walnut', 'Elder', 'Fig'] as const;

const sessions: RoastSessionWithRelations[] = NAMES.map((name, index) => {
    const day = String(11 - index).padStart(2, '0');
    return {
        id: `s-${name}`,
        roasted_at: `2026-01-${day}T00:00:00Z`,
        roast_level: 'Medium',
        duration_seconds: 600,
        drop_temp_celsius: 200,
        weight_grams: 1000,
        output_weight_grams: null,
        events: [],
        beans: { name, origin: 'Ethiopia', region: null, variety: null, process: null, farm: null },
        roast_profiles: null,
    } as unknown as RoastSessionWithRelations;
});

const paginatedCalls = vi.hoisted(() => [] as Array<{ enabled?: boolean; sortKey?: string; page?: number }>);
const listCalls = vi.hoisted(() => [] as Array<{ enabled?: boolean } | undefined>);

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));

vi.mock('@entities/roast', () => ({
    sessionBeanName: (session: { beans?: { name: string } | null; bean_label?: string | null }) =>
        session.beans?.name ?? session.bean_label ?? null,
    useDeleteRoastSession: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
    useRoastSessionFilterMeta: () => ({
        data: sessions.map((session) => ({ roasted_at: session.roasted_at, beans: { origin: 'Ethiopia' } })),
    }),
    useRoastSessions: (_userId: string, _status: string, options?: { enabled?: boolean }) => {
        listCalls.push(options);
        return { data: sessions, isLoading: false, isError: false };
    },
    useRoastSessionsPaginated: (params: { enabled?: boolean; sortKey?: string; page?: number; pageSize?: number }) => {
        paginatedCalls.push(params);
        const byDate = [...sessions].sort((a, b) => ((a.roasted_at ?? '') < (b.roasted_at ?? '') ? 1 : -1));
        const page = params.page ?? 1;
        const pageSize = params.pageSize ?? 10;
        const start = (page - 1) * pageSize;
        return {
            data: { data: byDate.slice(start, start + pageSize), total: sessions.length },
            isLoading: false,
            isError: false,
        };
    },
}));

vi.mock('@entities/roast-profile', () => ({
    useCreateRoastProfile: () => ({ mutateAsync: vi.fn() }),
    useSetProfileReference: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@features/export-csv', () => ({ useExportCsv: () => vi.fn() }));
vi.mock('@widgets/new-profile-modal', () => ({ NewProfileModal: () => null }));
vi.mock('./ui/HistorySessionDetail', () => ({ HistorySessionDetail: () => null }));
vi.mock('./ui/SessionCompareModal', () => ({ SessionCompareModal: () => null }));
vi.mock('./ui/HistoryTable', () => ({
    HistoryTable: ({
        sessions: rows,
        onSort,
        onPageChange,
    }: {
        sessions: Array<{ id: string; beans?: { name: string } | null }>;
        onSort: (key: string) => void;
        onPageChange: (page: number) => void;
    }) =>
        createElement(
            'div',
            null,
            createElement('button', { type: 'button', onClick: () => onSort('bean') }, 'sort-bean'),
            createElement('button', { type: 'button', onClick: () => onPageChange(2) }, 'page-2'),
            ...rows.map((session) =>
                createElement('div', { key: session.id, 'data-testid': 'history-bean' }, session.beans?.name ?? ''),
            ),
        ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const beanNamesOnPage = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('[data-testid="history-bean"]')].map((row) => row.textContent ?? '');

describe('History bean sort', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        paginatedCalls.length = 0;
        listCalls.length = 0;
    });

    const render = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(History));
        });
    };

    const click = (name: string) => {
        const button = [...host.querySelectorAll('button')].find((el) => el.textContent === name);
        act(() => {
            button?.click();
        });
    };

    it('sorts the filtered list, not the current date page', async () => {
        await render();

        expect(paginatedCalls[paginatedCalls.length - 1]?.enabled).toBe(true);
        expect(listCalls[listCalls.length - 1]?.enabled).toBe(false);

        click('sort-bean');

        expect(paginatedCalls[paginatedCalls.length - 1]).toMatchObject({ enabled: false, sortKey: 'bean' });
        expect(listCalls[listCalls.length - 1]?.enabled).toBe(true);
        // Oldest roast (Fig) is outside the first date page. Global name order still includes it.
        expect(beanNamesOnPage(host)).toEqual([
            'Zebra',
            'Yam',
            'Xray',
            'Walnut',
            'Mango',
            'Fig',
            'Elder',
            'Date',
            'Cherry',
            'Banana',
        ]);

        click('page-2');

        expect(beanNamesOnPage(host)).toEqual(['Apple']);
    });
});
