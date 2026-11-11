// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    profilePreviewBatches,
    profilePreviewOrphanSource,
    profilePreviewReference,
} from '../lib/profile-preview-fixtures';
import { useProfileBatchPreview } from './useProfileBatchPreview';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const curveState = vi.hoisted(() => ({
    path: 'curves/s3.tsv' as string | null,
    data: undefined as { t: number; bt: number }[] | undefined,
    pending: true,
    fetching: true,
}));

vi.mock('@entities/roast-profile', async () => {
    const actual = await vi.importActual<typeof import('@entities/roast-profile')>('@entities/roast-profile');
    return {
        ...actual,
        useRoastProfileCurve: (tsvPath: string | null | undefined) => ({
            data: tsvPath === curveState.path ? curveState.data : undefined,
            isPending: tsvPath === curveState.path ? curveState.pending : true,
            isFetching: tsvPath === curveState.path ? curveState.fetching : true,
            isError: false,
        }),
        useSourceSessionEvents: () => ({
            data: [{ id: 'drop', type: 'Drop' }],
        }),
    };
});

describe('useProfileBatchPreview', () => {
    let root: Root;
    let host: HTMLDivElement;
    let latest: ReturnType<typeof useProfileBatchPreview> | undefined;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        latest = undefined;
        curveState.path = 'curves/s3.tsv';
        curveState.data = undefined;
        curveState.pending = true;
        curveState.fetching = true;
    });

    const render = (input: Parameters<typeof useProfileBatchPreview>) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(
                createElement(() => {
                    latest = useProfileBatchPreview(...input);
                    return null;
                }),
            );
        });
    };

    it('loads the source_session tsv when the profile source is not in referenceBatches', () => {
        curveState.path = 'curves/picked.tsv';
        curveState.data = [{ t: 0, bt: 145 }];
        curveState.pending = false;
        curveState.fetching = false;
        render([profilePreviewOrphanSource, 'picked-session', profilePreviewBatches, false]);
        expect(latest?.points).toEqual([{ t: 0, bt: 145 }]);
        expect(latest?.batchTitle).toBe('New ZIPPER');
    });

    it('keeps loading while reference batches are still resolving a list selection', () => {
        render([profilePreviewReference, 's4', [], true]);
        expect(latest?.isLoading).toBe(true);
        expect(latest?.points).toEqual([]);
    });

    it('does not surface a slower curve for a session that is no longer selected', () => {
        curveState.path = 'curves/s4.tsv';
        curveState.data = [{ t: 0, bt: 190 }];
        curveState.pending = false;
        curveState.fetching = false;
        render([profilePreviewReference, 's3', profilePreviewBatches, false]);
        expect(latest?.points).toEqual([]);
        expect(latest?.isLoading).toBe(true);
    });
});
