// @vitest-environment jsdom

import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { History } from './History';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
    id: 's-current',
    roasted_at: '2026-01-11T00:00:00Z',
    roast_level: 'Medium',
    duration_seconds: 600,
    drop_temp_celsius: 200,
    weight_grams: 1000,
    events: [],
    beans: { name: 'Ethiopia', origin: 'Ethiopia' },
} as unknown as RoastSessionWithRelations;

const detailProps = vi.hoisted(() => ({
    current: null as {
        isCurrentReference?: boolean;
        backLabel?: string;
        onBack: () => void;
        onSetReference?: () => void;
    } | null,
}));

const profiles = vi.hoisted(() => ({
    sourceSessionId: 's-current',
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));

vi.mock('@entities/roast', () => ({
    useDeleteRoastSession: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
    useRoastSessionFilterMeta: () => ({ data: [{ roasted_at: session.roasted_at, beans: { origin: 'Ethiopia' } }] }),
    useRoastSessions: () => ({ data: [session], isLoading: false, isError: false }),
    useRoastSessionsPaginated: () => ({ data: { data: [session], total: 1 }, isLoading: false, isError: false }),
}));

vi.mock('@entities/roast-profile', () => ({
    useCreateRoastProfile: () => ({ mutateAsync: vi.fn() }),
    useRoastProfiles: () => ({
        data: [{ id: 'p1', name: 'Filter 1', source_session_id: profiles.sourceSessionId }],
        isSuccess: true,
    }),
    useSetProfileReference: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@features/export-csv', () => ({ useExportCsv: () => vi.fn() }));
vi.mock('@widgets/new-profile-modal', () => ({ NewProfileModal: () => null }));
vi.mock('./ui/SessionCompareModal', () => ({ SessionCompareModal: () => null }));
vi.mock('./ui/HistoryTable', () => ({
    HistoryTable: () => createElement('div', { 'data-testid': 'history-table' }),
}));
vi.mock('./ui/HistorySessionDetail', () => ({
    HistorySessionDetail: (props: NonNullable<(typeof detailProps)['current']>) => {
        detailProps.current = props;
        return createElement(
            'button',
            { type: 'button', 'data-testid': 'history-back', onClick: props.onBack },
            'back',
        );
    },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('History opened from a profile', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        detailProps.current = null;
        profiles.sourceSessionId = 's-current';
    });

    const render = async (onBackToProfile: () => void) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(
                createElement(History, {
                    focus: { sessionId: 's-current', profileId: 'p1' },
                    onBackToProfile,
                }),
            );
        });
    };

    it('marks the current reference and returns to the profile', async () => {
        const onBackToProfile = vi.fn();
        await render(onBackToProfile);

        expect(host.querySelector('[data-testid="history-table"]')).toBeNull();
        expect(detailProps.current?.isCurrentReference).toBe(true);
        expect(detailProps.current?.onSetReference).toBeUndefined();
        expect(detailProps.current?.backLabel).toBe('Filter 1');

        act(() => {
            host.querySelector<HTMLButtonElement>('[data-testid="history-back"]')?.click();
        });

        expect(onBackToProfile).toHaveBeenCalledOnce();
        expect(host.querySelector('[data-testid="history-table"]')).toBeNull();
    });

    it('offers set-as-reference when this roast is not the current one', async () => {
        profiles.sourceSessionId = 's-other';
        await render(vi.fn());

        expect(detailProps.current?.isCurrentReference).toBe(false);
        expect(detailProps.current?.onSetReference).toEqual(expect.any(Function));
        expect(detailProps.current?.backLabel).toBe('Filter 1');
    });
});
