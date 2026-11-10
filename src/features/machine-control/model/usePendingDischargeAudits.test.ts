// @vitest-environment jsdom
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingDischargeAudit } from '../lib/replayDischargeAudit';
import { usePendingDischargeAudits } from './usePendingDischargeAudits';

const mocks = vi.hoisted(() => ({
    append: vi.fn(),
    list: vi.fn(),
    ack: vi.fn(),
    capture: vi.fn(),
    mutationError: vi.fn(),
    actor: 'actor-a',
}));
vi.mock('@entities/roast-control-audit', () => ({ appendRoastControlAudit: mocks.append }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: mocks.capture } }));
vi.mock('@shared/store/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: mocks.actor } }) } }));
vi.mock('../lib/replayDischargeAudit', () => ({
    listPendingDischargeAudits: mocks.list,
    acknowledgeDischargeAudit: mocks.ack,
    replayDischargeAuditEvent: 'fc-replay-discharge-audit',
}));

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let records: PendingDischargeAudit[];
const entry = (commandId: string, ownerId = 'owner-a', actorId = 'actor-a'): PendingDischargeAudit => ({
    schemaVersion: 2,
    kind: 'intent',
    ownerId,
    actorId,
    commandId,
    sessionId: 'session',
    payload: { commandId },
});
const cleanup: Array<() => void> = [];
const mount = (actor = 'actor-a', ready = true) => {
    const root = createRoot(document.createElement('div'));
    const qc = new QueryClient({ mutationCache: new MutationCache({ onError: mocks.mutationError }) });
    function Probe(props: { actor: string; ready: boolean }) {
        usePendingDischargeAudits(props.actor, props.ready);
        return null;
    }
    const render = (nextActor = actor, nextReady = ready) =>
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(Probe, { actor: nextActor, ready: nextReady }),
                ),
            ),
        );
    render();
    cleanup.push(() => {
        act(() => root.unmount());
        qc.clear();
    });
    return { render };
};
beforeEach(() => {
    vi.clearAllMocks();
    records = [entry('first')];
    mocks.actor = 'actor-a';
    mocks.list.mockImplementation(async () => [...records]);
    mocks.append.mockResolvedValue('2026-11-10T06:00:00+00:00');
    mocks.ack.mockImplementation(async (record) => {
        records = records.filter((item) => item !== record);
    });
});
afterEach(async () => {
    for (const fn of cleanup.splice(0)) fn();
    await act(async () => {});
    vi.useRealTimers();
});

describe('discharge audit server delivery', () => {
    it('catches up on auth-ready startup across workspaces using each frozen owner, excluding other actors', async () => {
        records.push(entry('other-owner', 'owner-b'), entry('other-actor', 'owner-a', 'actor-b'));
        const h = mount('actor-a', false);
        await act(async () => {});
        expect(mocks.append).not.toHaveBeenCalled();
        await act(async () => h.render('actor-a', true));
        expect(mocks.append).toHaveBeenNthCalledWith(1, {
            p_user_id: 'owner-a',
            p_actor_id: 'actor-a',
            p_payload: { commandId: 'first' },
        });
        expect(mocks.append).toHaveBeenNthCalledWith(2, {
            p_user_id: 'owner-b',
            p_actor_id: 'actor-a',
            p_payload: { commandId: 'other-owner' },
        });
        expect(records.map((item) => item.commandId)).toEqual(['other-actor']);
    });

    it('keeps revoked workspace events without blocking other authorized workspaces', async () => {
        records.push(entry('authorized', 'owner-b'));
        mocks.append.mockRejectedValueOnce({ code: '42501' });
        mount();
        await act(async () => {});
        expect(mocks.append).toHaveBeenCalledTimes(2);
        expect(records.map((item) => item.commandId)).toEqual(['first']);
    });

    it('retains offline events and retries metadata on reconnect without acknowledging failure', async () => {
        mocks.append.mockRejectedValueOnce(new Error('offline'));
        mount();
        await act(async () => {});
        expect(mocks.ack).not.toHaveBeenCalled();
        expect(mocks.mutationError).toHaveBeenCalledOnce();
        expect(mocks.capture).not.toHaveBeenCalled();
        expect(records).toHaveLength(1);
        await act(async () => window.dispatchEvent(new Event('online')));
        expect(mocks.append).toHaveBeenCalledTimes(2);
        expect(mocks.append.mock.calls[1]).toEqual(mocks.append.mock.calls[0]);
        expect(records).toEqual([]);
    });

    it('retries an unacknowledged server success and coalesces new records arriving during upload', async () => {
        let finish!: (time: string) => void;
        mocks.append.mockImplementationOnce(
            () =>
                new Promise<string>((resolve) => {
                    finish = resolve;
                }),
        );
        mount();
        await act(async () => {});
        records.push(entry('second'));
        await act(async () => window.dispatchEvent(new Event('fc-replay-discharge-audit')));
        mocks.ack.mockRejectedValueOnce(new Error('disk full'));
        await act(async () => finish('2026-11-10T06:00:00+00:00'));
        expect(records).toEqual([]);
        expect(mocks.append).toHaveBeenCalledTimes(3);
        expect(mocks.append.mock.calls[1]).toEqual(mocks.append.mock.calls[0]);
    });

    it('revalidates auth before every request when an account switches mid-drain', async () => {
        records.push(entry('second'));
        mocks.append.mockImplementationOnce(async () => {
            mocks.actor = 'actor-b';
            return '2026-11-10T06:00:00+00:00';
        });
        mount();
        await act(async () => {});
        expect(mocks.append).toHaveBeenCalledOnce();
        expect(records.map((item) => item.commandId)).toEqual(['second']);
    });

    it('retries without an online event and cleans up the interval on unmount', async () => {
        vi.useFakeTimers();
        mocks.append.mockRejectedValueOnce(new Error('offline'));
        mount();
        await act(async () => {});
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(records).toEqual([]);
        for (const fn of cleanup.splice(0)) fn();
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(mocks.append).toHaveBeenCalledTimes(2);
    });
});
