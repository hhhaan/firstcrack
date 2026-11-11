// @vitest-environment jsdom

import type { ProfileReferenceBatch } from '@entities/roast-profile';
import { useToastStore } from '@shared/store/toast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { profilePreviewBatches } from '../lib/profile-preview-fixtures';
import { ProfileReferenceBatches } from './ProfileReferenceBatches';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const batches: ProfileReferenceBatch[] = profilePreviewBatches.map((batch) =>
    batch.id === 's3'
        ? { ...batch, batch_name: 'ZIPPER', heater_events: [{ heater: 2 }] }
        : { ...batch, batch_name: 'ZIPPER' },
);

const mutateAsync = vi.fn(() => Promise.resolve());
const onPreviewSession = vi.fn();
const { list, preview } = vi.hoisted(() => ({
    list: { current: [] as ProfileReferenceBatch[] },
    preview: { current: 's3' },
}));

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
            root.render(
                createElement(ProfileReferenceBatches, {
                    profileId: 'p1',
                    sourceSessionId: 's3',
                    previewSessionId: preview.current,
                    onPreviewSession,
                }),
            );
        });
    };

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        list.current = [];
        mutateAsync.mockReset();
        mutateAsync.mockImplementation(() => Promise.resolve());
        onPreviewSession.mockReset();
        preview.current = 's3';
        for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
    });

    it('marks the current reference and changes it only from the set button', () => {
        list.current = batches;
        render();
        const rows = [...host.querySelectorAll<HTMLLIElement>('[data-testid="profile-reference-row"]')];
        expect(rows.map((row) => row.dataset.current)).toEqual(['false', 'true']);
        expect(rows[1]?.textContent).toContain('profiles.detail.currentReference');
        expect(rows[1]?.textContent).toContain('#3 · PR31');
        expect(rows[0]?.textContent).toContain('profiles.detail.setReference');
        expect(rows[1]?.querySelector('[data-testid="profile-reference-set"]')).toBeNull();

        act(() => rows[0]?.querySelector<HTMLButtonElement>('[data-testid="profile-reference-preview"]')?.click());
        expect(onPreviewSession).toHaveBeenCalledWith('s4');
        expect(mutateAsync).not.toHaveBeenCalled();

        act(() => rows[0]?.querySelector<HTMLButtonElement>('[data-testid="profile-reference-set"]')?.click());

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
                    previewSessionId: 's3',
                    onPreviewSession,
                    onOpenDetail,
                }),
            );
        });
        const detail = host.querySelector<HTMLButtonElement>('[data-testid="profile-reference-detail"]');
        act(() => detail?.click());
        expect(onOpenDetail).toHaveBeenCalledWith('s4');
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it('does not write when the current reference row is clicked', () => {
        list.current = batches;
        render();
        const current = host.querySelector<HTMLLIElement>('[data-current="true"]');
        act(() => current?.querySelector<HTMLButtonElement>('[data-testid="profile-reference-preview"]')?.click());
        expect(onPreviewSession).toHaveBeenCalledWith('s3');
        expect(current?.querySelector('[data-testid="profile-reference-set"]')).toBeNull();
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it('stores the first batch as the reference when none is selected', () => {
        list.current = batches;
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(
                createElement(ProfileReferenceBatches, {
                    profileId: 'p1',
                    sourceSessionId: 'missing',
                    previewSessionId: 's4',
                    onPreviewSession,
                }),
            );
        });
        const rows = [...host.querySelectorAll<HTMLLIElement>('[data-testid="profile-reference-row"]')];
        expect(rows.map((row) => row.dataset.current)).toEqual(['true', 'false']);
        expect(rows[0]?.textContent).toContain('profiles.detail.currentReference');
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
        const set = host.querySelector<HTMLButtonElement>('[data-testid="profile-reference-set"]');

        await act(async () => {
            set?.click();
        });

        expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
            'profiles.detail.referenceFailed',
        ]);
    });
});
