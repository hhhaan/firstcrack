// @vitest-environment jsdom
import { type CuppingEventSummary, cuppingApi, cuppingKeys } from '@entities/cupping';
import type { CuppingEvent } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CuppingResultsShare } from './CuppingResultsShare';

vi.mock('@entities/cupping/api', () => ({
    cuppingApi: {
        ensureResultsToken: vi.fn(),
        getEvent: vi.fn(() => Promise.reject(new Error('unexpected getEvent'))),
    },
}));
const mocks = vi.hoisted(() => ({ language: 'en' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => `${mocks.language}:${key}` }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const event = { id: 'event', results_token: null, ended_at: '2026-10-01T00:00:00Z' } as CuppingEvent;
const summary = { ...event, sample_count: 2 } as CuppingEventSummary;

describe('results token mutation lifecycle', () => {
    let qc: QueryClient;
    let root: Root;
    let host: HTMLDivElement;
    let resolveToken: (event: CuppingEvent) => void;
    let mounted: boolean;
    const render = () =>
        act(() =>
            root.render(
                createElement(
                    StrictMode,
                    null,
                    createElement(
                        QueryClientProvider,
                        { client: qc },
                        createElement(CuppingResultsShare, { userId: 'owner', eventId: event.id, listEvent: summary }),
                    ),
                ),
            ),
        );
    beforeEach(() => {
        mocks.language = 'en';
        vi.mocked(cuppingApi.ensureResultsToken)
            .mockReset()
            .mockReturnValue(
                new Promise((resolve) => {
                    resolveToken = resolve;
                }),
            );
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        qc.setQueryData(cuppingKeys.event(event.id), event);
        qc.setQueryData(cuppingKeys.events('owner'), [summary]);
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        mounted = true;
    });
    afterEach(() => {
        if (mounted) act(() => root.unmount());
        host.remove();
        qc.clear();
    });

    it('sends one update in StrictMode and through a language change, then updates both caches', async () => {
        render();
        await act(async () => {});
        mocks.language = 'ko';
        render();
        await act(async () => {});
        expect(cuppingApi.ensureResultsToken).toHaveBeenCalledTimes(1);
        expect(cuppingApi.getEvent).not.toHaveBeenCalled();
        await act(async () => resolveToken({ ...event, results_token: 'token' }));
        expect(qc.getQueryData<CuppingEvent>(cuppingKeys.event(event.id))?.results_token).toBe('token');
        expect(qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events('owner'))?.[0].results_token).toBe('token');
    });

    it('still saves the token to both caches when unmounted before resolution', async () => {
        render();
        await act(async () => {});
        act(() => root.unmount());
        mounted = false;
        await act(async () => resolveToken({ ...event, results_token: 'after-unmount' }));
        expect(qc.getQueryData<CuppingEvent>(cuppingKeys.event(event.id))?.results_token).toBe('after-unmount');
        expect(qc.getQueryData<CuppingEventSummary[]>(cuppingKeys.events('owner'))?.[0].results_token).toBe(
            'after-unmount',
        );
    });
});
