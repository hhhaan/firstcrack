// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiles } from './Profiles';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profilesQuery = vi.hoisted(() => ({
    data: [] as { id: string; name: string }[],
    isLoading: true,
    isError: false,
}));

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
    resolveSourceSession: () => null,
    roastProfileCopyInsert: () => ({}),
}));

vi.mock('@widgets/new-profile-modal', () => ({ NewProfileModal: () => null }));
vi.mock('@widgets/profile-compare/ui/ProfileCompare', () => ({ ProfileCompare: () => null }));
vi.mock('@widgets/profile-detail/ui/ProfileDetail', () => ({ ProfileDetail: () => null }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const PROFILE_PULSE_COUNT = 5 * 3;
const DETAIL_PULSE_COUNT = 14;

describe('Profiles loading', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        profilesQuery.isLoading = true;
        profilesQuery.isError = false;
        profilesQuery.data = [];
    });

    const render = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(Profiles, { onNavigate: () => {} }));
        });
    };

    it('shows the header and card skeletons while profiles load', async () => {
        profilesQuery.isLoading = true;
        await render();

        expect(host.textContent).toContain('profiles.title');
        expect(host.textContent).toContain('profiles.newProfile');
        expect(host.textContent).not.toContain('common.loading');
        expect(host.textContent).not.toContain('profiles.empty');

        const status = host.querySelector('[role="status"]');
        expect(status?.getAttribute('aria-busy')).toBe('true');
        expect(status?.getAttribute('aria-label')).toBe('common.loading');
        expect(status?.querySelectorAll('.animate-pulse').length).toBe(PROFILE_PULSE_COUNT);
        expect(host.querySelector('.sticky')?.querySelectorAll('.animate-pulse').length).toBe(DETAIL_PULSE_COUNT);
    });

    it('keeps the empty state when loading finishes with no profiles', async () => {
        profilesQuery.isLoading = false;
        await render();

        expect(host.textContent).toContain('profiles.title');
        expect(host.textContent).toContain('profiles.newProfile');
        expect(host.textContent).toContain('profiles.empty');
        expect(host.textContent).toContain('profiles.createFirst');
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(host.querySelector('.sticky')).toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('shows an error instead of the empty state when the list request fails', async () => {
        profilesQuery.isLoading = false;
        profilesQuery.isError = true;
        await render();

        expect(host.textContent).toContain('profiles.title');
        expect(host.textContent).toContain('profiles.loadError');
        expect(host.textContent).not.toContain('profiles.empty');
        expect(host.textContent).not.toContain('profiles.createFirst');
        expect(host.textContent).not.toContain('profiles.subtitle');
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(host.querySelector('.sticky')).toBeNull();
    });
});
