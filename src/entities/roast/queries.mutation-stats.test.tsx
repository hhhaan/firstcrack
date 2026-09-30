// @vitest-environment jsdom

import { roastProfileQueryRoots } from '@shared/lib/query-keys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roastSessionApi } from './api';
import {
    useCreateRoastSession,
    useDeleteRoastSession,
    useSetOutputWeight,
    useUpdateRoastRecord,
    useUpdateRoastSession,
} from './queries';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./api', () => ({
    roastSessionApi: {
        create: vi.fn(async () => ({ id: 'created', user_id: 'user-1' })),
        update: vi.fn(async (row: { id: string }) => ({ id: row.id, user_id: 'user-1', status: 'completed' })),
        delete: vi.fn(async () => undefined),
        setOutputWeight: vi.fn(async () => undefined),
        updateRecord: vi.fn(async () => ({ id: 's1', user_id: 'user-1', status: 'completed' })),
    },
}));

const uid = 'user-1';
const historyKey = [...roastProfileQueryRoots.beanHistory, 'p1'];
const consistencyKey = [...roastProfileQueryRoots.consistency, 'p1'];

type Mutations = {
    create: ReturnType<typeof useCreateRoastSession>;
    update: ReturnType<typeof useUpdateRoastSession>;
    remove: ReturnType<typeof useDeleteRoastSession>;
    weight: ReturnType<typeof useSetOutputWeight>;
    record: ReturnType<typeof useUpdateRoastRecord>;
};

describe('roast mutations refresh profile stats', () => {
    let qc: QueryClient;
    let root: Root;
    let latest: Mutations;

    const flush = async () => {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    };

    function Probe() {
        latest = {
            create: useCreateRoastSession(uid),
            update: useUpdateRoastSession(uid),
            remove: useDeleteRoastSession(uid),
            weight: useSetOutputWeight(uid),
            record: useUpdateRoastRecord(uid),
        };
        return null;
    }

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        root = createRoot(document.createElement('div'));
        vi.mocked(roastSessionApi.create).mockClear();
        vi.mocked(roastSessionApi.update).mockClear();
        vi.mocked(roastSessionApi.delete).mockClear();
        vi.mocked(roastSessionApi.setOutputWeight).mockClear();
        vi.mocked(roastSessionApi.updateRecord).mockClear();
    });

    afterEach(() => {
        act(() => root.unmount());
        qc.clear();
    });

    const seed = () => {
        qc.setQueryData(historyKey, [{ name: 'Yirg', count: 1, lastDate: '2026-09-01' }]);
        qc.setQueryData(consistencyKey, [{ weight_grams: 1000 }]);
    };

    const expectStatsInvalidated = async () => {
        for (let i = 0; i < 20; i++) {
            const history = qc.getQueryState(historyKey)?.isInvalidated;
            const consistency = qc.getQueryState(consistencyKey)?.isInvalidated;
            if (history && consistency) return;
            await flush();
        }
        expect(qc.getQueryState(historyKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(consistencyKey)?.isInvalidated).toBe(true);
    };

    it('save, update, delete, output weight, and record edit share one stats invalidation', async () => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });

        const run = async (mutate: () => Promise<unknown>) => {
            seed();
            await act(async () => {
                await mutate();
            });
            await expectStatsInvalidated();
        };

        await run(() => latest.create.mutateAsync({} as never));
        await run(() => latest.update.mutateAsync({ id: 's1' } as never));
        await run(() => latest.remove.mutateAsync('s1'));
        await run(() =>
            latest.weight.mutateAsync({
                sessionId: 's1',
                outputGrams: 850,
                inboundGrams: 850,
                inboundIsEstimate: false,
            }),
        );
        await run(() =>
            latest.record.mutateAsync({
                sessionId: 's1',
                expectedEvents: [],
                expectedHeaterEvents: null,
                events: [],
                heaterEvents: null,
                dropTempCelsius: 200,
                durationSeconds: 600,
                profileSummary: null,
            }),
        );
    });
});
