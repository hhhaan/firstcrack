// @vitest-environment jsdom

import type { ProfileReferenceBatch, RoastProfileWithSource } from '@entities/roast-profile';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProfileBatchPreview } from './useProfileBatchPreview';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const batches: ProfileReferenceBatch[] = [
    {
        id: 's4',
        roasted_at: '2026-10-22T01:00:00Z',
        batch_name: 'ZIPPER 4',
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
        batch_name: 'ZIPPER 3',
        bean_label: null,
        profile_batch_number: 3,
        total_batch_number: 31,
        tsv_path: 'curves/s3.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        beans: null,
        blends: null,
    },
];

const profile = {
    id: 'p1',
    user_id: 'owner',
    source_session_id: 's3',
    source_session: { tsv_path: 'curves/s3.tsv', events: null },
    duration_sec: 600,
} as RoastProfileWithSource;

const curveState = vi.hoisted(() => ({
    path: 'curves/s3.tsv' as string | null,
    data: undefined as { t: number; bt: number }[] | undefined,
    pending: true,
    fetching: true,
    sessionId: 's3',
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

const Probe = ({ sessionId }: { sessionId: string }) => {
    curveState.sessionId = sessionId;
    return null;
};

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
        curveState.sessionId = 's3';
    });

    const render = (sessionId: string) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(
                createElement(() => {
                    latest = useProfileBatchPreview(profile, sessionId, batches);
                    return createElement(Probe, { sessionId });
                }),
            );
        });
    };

    it('keeps points empty while the active curve query is pending', () => {
        curveState.path = 'curves/s4.tsv';
        curveState.data = undefined;
        curveState.pending = true;
        curveState.fetching = true;
        render('s4');
        expect(latest?.points).toEqual([]);
        expect(latest?.isLoading).toBe(true);
    });

    it('returns the selected batch curve and title once loaded', () => {
        curveState.path = 'curves/s3.tsv';
        curveState.data = [{ t: 0, bt: 150 }];
        curveState.pending = false;
        curveState.fetching = false;
        render('s3');
        expect(latest?.points).toEqual([{ t: 0, bt: 150 }]);
        expect(latest?.batchTitle).toBe('ZIPPER 3');
        expect(latest?.chartProfile.source_session_id).toBe('s3');
    });

    it('does not surface a slower curve for a session that is no longer selected', () => {
        curveState.path = 'curves/s4.tsv';
        curveState.data = [{ t: 0, bt: 190 }];
        curveState.pending = false;
        curveState.fetching = false;
        render('s3');
        expect(latest?.points).toEqual([]);
        expect(latest?.isLoading).toBe(true);
    });
});
