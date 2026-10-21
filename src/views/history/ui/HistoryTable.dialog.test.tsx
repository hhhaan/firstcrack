// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistorySessionDetail } from './HistorySessionDetail';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@widgets/profile-curve-chart/ui/ProfileCurveChart', () => ({
    COMPARE_COLORS: ['var(--color-palette-blue)'],
}));
vi.mock('./OutputWeightEditor', () => ({ OutputWeightEditor: () => null }));
vi.mock('./SessionScorecard', () => ({ SessionScorecard: () => null }));
vi.mock('./HistorySessionChart', () => ({ HistorySessionChart: () => null }));
vi.mock('../hooks/useRoastStockRecorded', () => ({
    useRoastStockRecorded: () => ({ data: false, isPending: false }),
}));
vi.mock('../hooks/useRoastRecordSave', () => ({
    useRoastRecordSave: () => ({
        canWrite: true,
        isPending: false,
        saveEvents: vi.fn(),
        saveHeater: vi.fn(),
        errorText: () => 'failed',
    }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return { ...actual, useQueryClient: () => ({}) };
});
vi.mock('@entities/bean', () => ({
    useBeans: () => ({ data: [] }),
}));
vi.mock('@features/update-roast-bean-origin', () => ({
    useUpdateRoastBeanOrigin: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({ data: [] }),
}));
vi.mock('@entities/roast', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/roast')>();
    return {
        ...actual,
        useHistoryChart: () => ({ points: [], isLoading: false, isError: false }),
        useUpdateRoastSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
        useSetChargeWeight: () => ({ mutateAsync: vi.fn(), isPending: false }),
        useSetOutputWeight: () => ({ mutateAsync: vi.fn(), isPending: false }),
        useSetRoastLevel: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
        color_whole: '58.4',
        color_ground: '63',
    }) as unknown as RoastSessionWithRelations;

describe('HistorySessionDetail edit dialog', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
    });

    it('shows Drop-based results without a profile and leaves missing development metrics blank', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const record = session(1);
        record.duration_seconds = 660;
        record.events = [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'fc', type: 'FC Start', time_sec: 480, temp_c: 195 },
            { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210 },
            { id: 'e', type: 'End', time_sec: 660, temp_c: 208 },
        ];
        const render = async (value: RoastSessionWithRelations) => {
            await act(async () => {
                root.render(
                    createElement(HistorySessionDetail, {
                        session: value,
                        onBack: () => {},
                        onSaveAsProfile: () => {},
                    }),
                );
            });
        };

        await render(record);
        expect((host.querySelector('[data-testid="history-color-whole"]') as HTMLInputElement).value).toBe('58.4');
        expect((host.querySelector('[data-testid="history-color-ground"]') as HTMLInputElement).value).toBe('63');
        const values = () => [...host.querySelectorAll('section[aria-label="history.expanded.summary"] dd')];
        expect(values().map((el) => el.textContent)).toEqual(['10:00', '210.0°C', '2:00', '20.0%']);
        await render({ ...session(2), beans: null, bean_label: null });
        expect(host.querySelector('h1')?.textContent).toBe('26-01-15');
        expect(
            values()
                .slice(2)
                .map((el) => el.textContent),
        ).toEqual(['—', '—']);
    });

    it('mounts the edit dialog on document.body', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(
                createElement(HistorySessionDetail, {
                    session: session(1),
                    onBack: () => {},
                    onSaveAsProfile: () => {},
                }),
            );
        });

        const edit = host.querySelector('[data-testid="history-edit-events"]') as HTMLButtonElement;
        await act(async () => {
            edit.click();
        });

        const dialog = document.querySelector('[data-testid="record-events-editor"]');
        const overlay = dialog?.parentElement;
        expect(overlay?.getAttribute('role')).toBe('presentation');
        expect(overlay?.className).toContain('fixed');
        expect(overlay?.className).toContain('inset-0');
        expect(overlay?.parentElement).toBe(document.body);
        expect(host.contains(dialog)).toBe(false);
    });
});
