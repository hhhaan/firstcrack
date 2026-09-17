// @vitest-environment jsdom
import { fetchTsvFromR2 } from '@shared/lib/r2';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useBbpCurve } from './chart-queries';

vi.mock('@shared/lib/r2', () => ({ fetchTsvFromR2: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tsv = 'time\tbt\tet\n2\t210\t215\n92\t185\t190\n';

describe('saved BBP queries', () => {
    it.each(['owner-a', 'owner-b'])(
        'isolates target/workspace changes to %s and Charge from late downloads',
        async (nextOwner) => {
            const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            const root = createRoot(document.createElement('div'));
            let result!: ReturnType<typeof useBbpCurve>;
            function Probe({
                owner,
                session,
                path,
                enabled,
            }: {
                owner: string;
                session: string;
                path: string | null;
                enabled: boolean;
            }) {
                result = useBbpCurve(owner, session, path, enabled);
                return null;
            }
            const render = async (owner: string, session: string, path: string | null, enabled = true) => {
                await act(async () => {
                    root.render(
                        <QueryClientProvider client={client}>
                            <Probe owner={owner} session={session} path={path} enabled={enabled} />
                        </QueryClientProvider>,
                    );
                });
            };
            const flush = async () => {
                await act(async () => {
                    await new Promise((r) => setTimeout(r, 10));
                });
            };
            let finishOld!: (text: string) => void;
            vi.mocked(fetchTsvFromR2).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishOld = resolve;
                    }),
            );
            await render('owner-a', 'session-a', 'a.bbp.tsv');
            expect(result.isLoading).toBe(true);
            vi.mocked(fetchTsvFromR2).mockResolvedValueOnce(tsv);
            await render(nextOwner, 'session-b', 'b.bbp.tsv');
            await flush();
            expect(result.data?.map((p) => [p.t, p.bt])).toEqual([
                [2, 210],
                [92, 185],
            ]);
            finishOld('time\tbt\n1\t999\n');
            await flush();
            expect(result.data?.[0].bt).toBe(210);

            await render(nextOwner, 'session-without-bbp', null);
            expect(result.data).toBeUndefined();
            expect(result.isLoading).toBe(false);
            expect(result.isError).toBe(false);
            vi.mocked(fetchTsvFromR2).mockRejectedValueOnce(new Error('download failed'));
            await render(nextOwner, 'failed-session', 'failed.bbp.tsv');
            await flush();
            expect(result.isError).toBe(true);
            expect(result.data).toBeUndefined();

            vi.mocked(fetchTsvFromR2).mockResolvedValueOnce('time\tbt\n');
            await render(nextOwner, 'empty-session', 'empty.bbp.tsv');
            await flush();
            expect(result.data).toEqual([]);
            expect(result.isError).toBe(false);

            await render(nextOwner, 'session-b', 'b.bbp.tsv');
            expect(result.data).toHaveLength(2);
            await render(nextOwner, 'session-b', 'b.bbp.tsv', false);
            expect(result.data).toBeUndefined();
            let finishAfterCharge!: (text: string) => void;
            vi.mocked(fetchTsvFromR2).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishAfterCharge = resolve;
                    }),
            );
            await render(nextOwner, 'pending-charge', 'pending.bbp.tsv');
            expect(result.isLoading).toBe(true);
            await render(nextOwner, 'pending-charge', 'pending.bbp.tsv', false);
            finishAfterCharge(tsv);
            await flush();
            expect(result.data).toBeUndefined();
            await render('', 'session-b', 'b.bbp.tsv');
            expect(result.data).toBeUndefined();
            expect(result.isLoading).toBe(false);
            await act(async () => root.unmount());
            client.clear();
        },
    );
});
