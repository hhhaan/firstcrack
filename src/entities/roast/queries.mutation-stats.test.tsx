// @vitest-environment jsdom

import { roastProfileQueryRoots } from '@shared/lib/query-keys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roastSessionApi } from './api';
import {
    roastSessionKeys,
    useDeleteRoastSession,
    useSetChargeWeight,
    useSetOutputWeight,
    useUpdateRoastRecord,
    useUpdateRoastSession,
} from './queries';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./api', () => ({
    roastSessionApi: {
        update: vi.fn(async (row: { id: string }) => ({ id: row.id, user_id: 'user-1', status: 'completed' })),
        delete: vi.fn(async () => undefined),
        setOutputWeight: vi.fn(async () => undefined),
        setChargeWeight: vi.fn(async () => undefined),
        updateRecord: vi.fn(async () => ({ id: 's1', user_id: 'user-1', status: 'completed' })),
    },
}));

const uid = 'user-1';
const historyKey = [...roastProfileQueryRoots.beanHistory, 'p1'];
const consistencyKey = [...roastProfileQueryRoots.consistency, 'p1'];

type Mutations = {
    update: ReturnType<typeof useUpdateRoastSession>;
    remove: ReturnType<typeof useDeleteRoastSession>;
    weight: ReturnType<typeof useSetOutputWeight>;
    charge: ReturnType<typeof useSetChargeWeight>;
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
            update: useUpdateRoastSession(uid),
            remove: useDeleteRoastSession(uid),
            weight: useSetOutputWeight(uid),
            charge: useSetChargeWeight(uid),
            record: useUpdateRoastRecord(uid),
        };
        return null;
    }

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        root = createRoot(document.createElement('div'));
        vi.mocked(roastSessionApi.update).mockClear();
        vi.mocked(roastSessionApi.delete).mockClear();
        vi.mocked(roastSessionApi.setOutputWeight).mockClear();
        vi.mocked(roastSessionApi.setChargeWeight).mockClear();
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
            latest.charge.mutateAsync({
                sessionId: 's1',
                weightGrams: 900,
                inboundGrams: 740,
                inboundIsEstimate: true,
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

    const pageKey = roastSessionKeys.paginated(uid, 'completed', 1, 10);
    const row = {
        id: 's1',
        status: 'completed',
        notes: 'old',
        events: [{ type: 'Charge' }],
        heater_events: null,
        drop_temp_celsius: 180,
        duration_seconds: 500,
        weight_grams: 1000,
        output_weight_grams: null,
        profile_id: null,
        roast_profiles: { name: 'Old', target_level: null },
        beans: null,
    };

    const mount = async () => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });
    };

    const pageRow = () => (qc.getQueryData(pageKey) as { data: Array<typeof row> }).data[0];

    it('patches the history page before the server answers', async () => {
        qc.setQueryData(pageKey, { data: [row], total: 1 });
        let release: (() => void) | undefined;
        const gate = () =>
            new Promise<void>((resolve) => {
                release = resolve;
            });
        vi.mocked(roastSessionApi.update).mockImplementationOnce(async () => {
            await gate();
            return { id: 's1', user_id: uid, status: 'completed' } as Awaited<
                ReturnType<typeof roastSessionApi.update>
            >;
        });
        await mount();

        let pending: Promise<unknown> = Promise.resolve();
        await act(async () => {
            pending = latest.update.mutateAsync({ id: 's1', notes: 'next' });
        });
        for (let i = 0; i < 20 && pageRow().notes !== 'next'; i++) await flush();
        expect(pageRow().notes).toBe('next');
        expect(pageRow().profile_id).toBe(row.profile_id);
        expect(pageRow().roast_profiles).toEqual(row.roast_profiles);

        await act(async () => {
            release?.();
            await pending;
        });

        qc.setQueryData(pageKey, { data: [{ ...row }], total: 1 });
        vi.mocked(roastSessionApi.updateRecord).mockImplementationOnce(async () => {
            await gate();
            return { id: 's1', user_id: uid, status: 'completed' } as Awaited<
                ReturnType<typeof roastSessionApi.updateRecord>
            >;
        });
        await act(async () => {
            pending = latest.record.mutateAsync({
                sessionId: 's1',
                expectedEvents: row.events,
                expectedHeaterEvents: null,
                events: [{ type: 'Note' }],
                heaterEvents: null,
                dropTempCelsius: 210,
                durationSeconds: 640,
                profileSummary: null,
            });
        });
        for (let i = 0; i < 20 && pageRow().drop_temp_celsius !== 210; i++) await flush();
        expect(pageRow().events).toEqual([{ type: 'Note' }]);
        expect(pageRow().duration_seconds).toBe(640);
        await act(async () => {
            release?.();
            await pending;
        });

        qc.setQueryData(pageKey, { data: [{ ...row }], total: 1 });
        vi.mocked(roastSessionApi.setOutputWeight).mockImplementationOnce(gate);
        await act(async () => {
            pending = latest.weight.mutateAsync({
                sessionId: 's1',
                outputGrams: 850,
                inboundGrams: 850,
                inboundIsEstimate: false,
            });
        });
        for (let i = 0; i < 20 && pageRow().output_weight_grams !== 850; i++) await flush();
        expect(pageRow().output_weight_grams).toBe(850);
        await act(async () => {
            release?.();
            await pending;
        });

        qc.setQueryData(pageKey, { data: [{ ...row }], total: 1 });
        vi.mocked(roastSessionApi.setChargeWeight).mockImplementationOnce(gate);
        await act(async () => {
            pending = latest.charge.mutateAsync({
                sessionId: 's1',
                weightGrams: 900,
                inboundGrams: 740,
                inboundIsEstimate: true,
            });
        });
        for (let i = 0; i < 20 && pageRow().weight_grams !== 900; i++) await flush();
        expect(pageRow().weight_grams).toBe(900);
        await act(async () => {
            release?.();
            await pending;
        });
    });

    it('restores the history page when a record, output, or charge edit fails', async () => {
        qc.setQueryData(pageKey, { data: [{ ...row }], total: 1 });
        vi.mocked(roastSessionApi.updateRecord).mockRejectedValueOnce(new Error('conflict'));
        vi.mocked(roastSessionApi.setOutputWeight).mockRejectedValueOnce(new Error('output'));
        vi.mocked(roastSessionApi.setChargeWeight).mockRejectedValueOnce(new Error('charge'));
        await mount();

        await act(async () => {
            await latest.record
                .mutateAsync({
                    sessionId: 's1',
                    expectedEvents: row.events,
                    expectedHeaterEvents: null,
                    events: [{ type: 'Note' }],
                    heaterEvents: [{ t: 1 }],
                    dropTempCelsius: 200,
                    durationSeconds: 600,
                    profileSummary: null,
                })
                .catch(() => undefined);
        });
        expect(pageRow().events).toEqual(row.events);
        expect(pageRow().drop_temp_celsius).toBe(180);

        await act(async () => {
            await latest.weight
                .mutateAsync({ sessionId: 's1', outputGrams: 850, inboundGrams: 850, inboundIsEstimate: false })
                .catch(() => undefined);
        });
        expect(pageRow().output_weight_grams).toBeNull();

        await act(async () => {
            await latest.charge
                .mutateAsync({ sessionId: 's1', weightGrams: 900, inboundGrams: 740, inboundIsEstimate: true })
                .catch(() => undefined);
        });
        expect(pageRow().weight_grams).toBe(1000);
    });
});
