// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CuppingSampleWithMeta, cuppingApi } from './api';
import { cuppingKeys, useReorderCuppingSamples } from './queries';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./api', async (importOriginal) => {
    const original = await importOriginal<typeof import('./api')>();
    return { ...original, cuppingApi: { ...original.cuppingApi, reorderSamples: vi.fn() } };
});

describe('useReorderCuppingSamples', () => {
    const roots: ReturnType<typeof createRoot>[] = [];

    afterEach(() => {
        for (const root of roots) act(() => root.unmount());
        vi.mocked(cuppingApi.reorderSamples).mockReset();
    });

    it('optimistically reorders and restores the prior cache when the RPC fails', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const eventId = 'event-1';
        const previous = [
            { id: 'a', event_id: eventId, sort_order: 0 },
            { id: 'b', event_id: eventId, sort_order: 1 },
        ] as CuppingSampleWithMeta[];
        qc.setQueryData(cuppingKeys.samples(eventId), previous);

        let mutation!: ReturnType<typeof useReorderCuppingSamples>;
        function Probe() {
            mutation = useReorderCuppingSamples(eventId);
            return null;
        }
        const root = createRoot(document.createElement('div'));
        roots.push(root);
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });

        let reject!: (error: Error) => void;
        vi.mocked(cuppingApi.reorderSamples).mockReturnValue(
            new Promise<void>((_resolve, rejectPromise) => {
                reject = rejectPromise;
            }),
        );
        const pending = mutation.mutateAsync(['b', 'a']);
        await act(async () => undefined);
        expect(qc.getQueryData<CuppingSampleWithMeta[]>(cuppingKeys.samples(eventId))?.map((s) => s.id)).toEqual([
            'b',
            'a',
        ]);

        reject(new Error('atomic reorder failed'));
        await act(async () => {
            await expect(pending).rejects.toThrow('atomic reorder failed');
        });
        expect(qc.getQueryData(cuppingKeys.samples(eventId))).toEqual(previous);
        expect(cuppingApi.reorderSamples).toHaveBeenCalledWith(eventId, ['b', 'a']);
    });
});
