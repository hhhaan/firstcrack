// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiles } from './Profiles';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const profilesQuery = vi.hoisted(() => ({
    data: [
        {
            id: 'p1',
            name: 'Alpha',
            source_session_id: 's1',
            source_session: { tsv_path: 'a.tsv', events: null },
            drop_temp_celsius: 200,
            duration_sec: 600,
        },
        {
            id: 'p2',
            name: 'Beta',
            source_session_id: 's2',
            source_session: { tsv_path: 'b.tsv', events: null },
            drop_temp_celsius: 200,
            duration_sec: 600,
        },
    ],
    batchCounters: undefined,
    isLoading: false,
    isError: false,
}));

const detailMounts = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));
vi.mock('@entities/profile', () => ({
    useProfile: () => ({ data: undefined }),
    useUpdateProfile: () => ({ mutate: vi.fn() }),
}));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => profilesQuery,
    useCreateRoastProfile: () => ({ mutateAsync: vi.fn() }),
    useDeleteRoastProfile: () => ({ mutate: vi.fn() }),
    useUpdateRoastProfile: () => ({ mutateAsync: vi.fn() }),
    useRoastProfileCurve: () => ({ data: [] }),
    resolveSourceSession: (session: unknown) => session,
    roastProfileCopyInsert: () => ({}),
}));
vi.mock('@widgets/new-profile-modal', () => ({ NewProfileModal: () => null }));
vi.mock('@widgets/profile-compare/ui/ProfileCompare', () => ({ ProfileCompare: () => null }));
vi.mock('@widgets/profile-detail/ui/ProfileDetail', () => ({
    ProfileDetail: (props: { selected: { id: string } }) => {
        detailMounts.ids.push(props.selected.id);
        return createElement('div', { 'data-testid': 'profile-detail', 'data-profile-id': props.selected.id });
    },
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Profiles preview switch', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        detailMounts.ids = [];
    });

    it('remounts ProfileDetail when the selected profile id changes', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(Profiles, { onNavigate: () => {} }));
        });

        const cardFor = (name: string) =>
            [...host.querySelectorAll('span')].find((node) => node.textContent === name)?.closest('.rounded-2xl');
        await act(async () => {
            cardFor('Beta')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await act(async () => {
            cardFor('Alpha')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(detailMounts.ids.filter((id) => id === 'p2').length).toBeGreaterThanOrEqual(1);
        expect(detailMounts.ids[detailMounts.ids.length - 1]).toBe('p1');
        expect(detailMounts.ids.filter((id) => id === 'p1').length).toBeGreaterThanOrEqual(2);
    });
});
