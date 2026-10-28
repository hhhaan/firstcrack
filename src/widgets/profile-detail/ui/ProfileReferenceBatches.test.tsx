// @vitest-environment jsdom

import type { ProfileReferenceBatch } from '@entities/roast-profile';
import { useToastStore } from '@shared/store/toast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileReferenceBatches } from './ProfileReferenceBatches';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const batches: ProfileReferenceBatch[] = [
    {
        id: 's4',
        roasted_at: '2026-10-22T01:00:00Z',
        batch_name: 'ZIPPER',
        bean_label: null,
        profile_batch_number: 4,
        total_batch_number: 40,
        tsv_path: 'curves/s4.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        beans: null,
        blends: null,
    },
    {
        id: 's3',
        roasted_at: '2026-10-18T01:00:00Z',
        batch_name: 'ZIPPER',
        bean_label: null,
        profile_batch_number: 3,
        total_batch_number: 31,
        tsv_path: 'curves/s3.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        heater_events: [{ heater: 2 }],
        beans: null,
        blends: null,
    },
];

const mutateAsync = vi.fn(() => Promise.resolve());
const { list } = vi.hoisted(() => ({ list: { current: [] as ProfileReferenceBatch[] } }));

vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@entities/roast-profile', () => ({
    useProfileReferenceBatches: () => ({ data: list.current }),
    useSetProfileReference: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('ProfileReferenceBatches', () => {
    let root: Root;
    let host: HTMLDivElement;

    const render = () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(createElement(ProfileReferenceBatches, { profileId: 'p1', sourceSessionId: 's3' }));
        });
    };

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        list.current = [];
        mutateAsync.mockReset();
        mutateAsync.mockImplementation(() => Promise.resolve());
        for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
    });

    it('marks the current reference and selects another batch without its heater plan', () => {
        list.current = batches;
        render();
        const rows = [...host.querySelectorAll<HTMLTableRowElement>('[data-testid="profile-reference-row"]')];
        expect(rows.map((row) => row.dataset.current)).toEqual(['false', 'true']);
        expect(rows[1]?.textContent).toContain('newProfileModal.basedOn');
        expect(rows[1]?.textContent).toContain('#3 · PR #31');

        act(() => rows[0]?.click());

        expect(mutateAsync).toHaveBeenCalledWith({
            id: 'p1',
            sourceSessionId: 's4',
            sourceSession: { tsv_path: 'curves/s4.tsv', bbp_tsv_path: null, bbp_seconds: null, events: null },
        });
    });

    it('opens the history record without changing the reference', () => {
        list.current = batches;
        const onOpenDetail = vi.fn();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(
                createElement(ProfileReferenceBatches, {
                    profileId: 'p1',
                    sourceSessionId: 's3',
                    onOpenDetail,
                }),
            );
        });
        const detail = host.querySelector<HTMLButtonElement>('[data-testid="profile-reference-detail"]');
        act(() => detail?.click());
        expect(onOpenDetail).toHaveBeenCalledWith('s4');
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it('does not write when the current reference is chosen again', () => {
        list.current = batches;
        render();
        const current = host.querySelector<HTMLTableRowElement>('[data-current="true"]');
        act(() => current?.click());
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it('stores the first batch as the reference when none is selected', () => {
        list.current = batches;
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(createElement(ProfileReferenceBatches, { profileId: 'p1', sourceSessionId: 'missing' }));
        });
        const rows = [...host.querySelectorAll<HTMLTableRowElement>('[data-testid="profile-reference-row"]')];
        expect(rows.map((row) => row.dataset.current)).toEqual(['true', 'false']);
        expect(rows[0]?.textContent).toContain('newProfileModal.basedOn');
        expect(mutateAsync).toHaveBeenCalledWith({
            id: 'p1',
            sourceSessionId: 's4',
            sourceSession: { tsv_path: 'curves/s4.tsv', bbp_tsv_path: null, bbp_seconds: null, events: null },
        });
    });

    it('renders nothing when the profile has no saved batches', () => {
        render();
        expect(host.textContent).toBe('');
    });

    it('shows the reference failure', async () => {
        list.current = batches;
        mutateAsync.mockImplementationOnce(() => Promise.reject(new Error('update failed')));
        render();
        const row = host.querySelector<HTMLTableRowElement>('[data-current="false"]');

        await act(async () => {
            row?.click();
        });

        expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
            'profiles.detail.referenceFailed',
        ]);
    });
});
