// @vitest-environment jsdom
import { fetchProfile } from '@shared/lib/profile';
import { profileKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import type { Profile } from '@shared/types/database.types';
import type { User } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileSync } from './useProfileSync';

const native = vi.hoisted(() => ({
    listen: vi.fn(),
    stop: vi.fn(),
    focus: (_event: { payload: boolean }) => {},
}));
vi.mock('@shared/lib/profile', () => ({ fetchProfile: vi.fn() }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: native.listen }) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function Probe() {
    useProfileSync();
    return null;
}

describe('account profile synchronization', () => {
    let qc: QueryClient;
    let root: Root;
    let host: HTMLDivElement;
    let serverPlan: string;
    const key = profileKeys.detail('account-a');
    const tick = async (ms = 1) => act(async () => vi.advanceTimersByTimeAsync(ms));

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        native.listen.mockImplementation(async (callback: typeof native.focus) => {
            native.focus = callback;
            return native.stop;
        });
        serverPlan = 'trial';
        vi.mocked(fetchProfile).mockImplementation(async (id) => ({ id, plan: serverPlan }) as Profile);
        useAuthStore.setState({ user: { id: 'account-a' } as User });
        qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } } });
        qc.setQueryData(key, { id: 'account-a', plan: 'trial' });
        host = document.createElement('div');
        root = createRoot(host);
        await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe))));
        await tick();
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        qc.clear();
        useAuthStore.setState({ user: null });
        vi.useRealTimers();
    });

    it('refreshes the shared plan cache on native return and catches a later webhook', async () => {
        const gate = new QueryObserver(qc, { queryKey: key, select: (row: Profile) => row.plan });
        const stop = gate.subscribe(() => {});
        await act(async () => native.focus({ payload: false }));
        const before = vi.mocked(fetchProfile).mock.calls.length;
        await tick(60_000);
        expect(fetchProfile).toHaveBeenCalledTimes(before);
        await act(async () => native.focus({ payload: true }));
        await tick();
        expect(fetchProfile).toHaveBeenCalledTimes(before + 1);
        expect(gate.getCurrentResult().data).toBe('trial');
        serverPlan = 'pro';
        await tick(30_000);
        expect(gate.getCurrentResult().data).toBe('pro');
        serverPlan = 'read_only';
        await tick(30_000);
        expect(gate.getCurrentResult().data).toBe('read_only');
        stop();
    });

    it('refreshes on browser focus without fetching unrelated cached queries', async () => {
        const inventory = vi.fn(async () => ['beans']);
        const observer = new QueryObserver(qc, { queryKey: ['inventory'], queryFn: inventory });
        const stop = observer.subscribe(() => {});
        await tick();
        serverPlan = 'pro_plus';
        await act(async () => window.dispatchEvent(new Event('focus')));
        await tick();
        expect(qc.getQueryData<Profile>(key)?.plan).toBe('pro_plus');
        expect(inventory).toHaveBeenCalledTimes(1);
        stop();
    });

    it('pauses during profile edits so focus and polling cannot replace optimistic fields', async () => {
        let finish!: () => void;
        const mutation = qc.getMutationCache().build(qc, {
            mutationKey: [...key, 'update'],
            mutationFn: () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        });
        let pending!: Promise<void>;
        await act(async () => {
            pending = mutation.execute(undefined);
        });
        await tick();
        qc.setQueryData(key, { id: 'account-a', plan: 'trial', display_name: 'Pending edit' });
        const before = vi.mocked(fetchProfile).mock.calls.length;
        await act(async () => window.dispatchEvent(new Event('focus')));
        await tick(60_000);
        expect(fetchProfile).toHaveBeenCalledTimes(before);
        expect(qc.getQueryData<Profile>(key)?.display_name).toBe('Pending edit');
        await act(async () => {
            finish();
            await pending;
        });
    });

    it('switches the synchronization account and stops requests after logout', async () => {
        await act(async () => useAuthStore.setState({ user: { id: 'account-b' } as User }));
        await tick();
        expect(fetchProfile).toHaveBeenLastCalledWith('account-b');
        expect(native.stop).toHaveBeenCalledOnce();
        await act(async () => useAuthStore.setState({ user: null }));
        const before = vi.mocked(fetchProfile).mock.calls.length;
        await act(async () => window.dispatchEvent(new Event('focus')));
        await tick(60_000);
        expect(fetchProfile).toHaveBeenCalledTimes(before);
        expect(native.stop).toHaveBeenCalledTimes(2);
    });

    it('unsubscribes if native listener registration finishes after logout', async () => {
        let registered!: (stop: () => void) => void;
        native.listen.mockReturnValueOnce(
            new Promise<() => void>((resolve) => {
                registered = resolve;
            }),
        );
        await act(async () => useAuthStore.setState({ user: { id: 'account-b' } as User }));
        await act(async () => useAuthStore.setState({ user: null }));
        const stopLate = vi.fn();
        await act(async () => registered(stopLate));
        expect(stopLate).toHaveBeenCalledOnce();
    });
});
