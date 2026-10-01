// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { _resetTsvWriterForTests } from '@shared/lib/tsv-writer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveRoast } from './ActiveRoast';

const RUNNING_CLOSE = '로스팅이 진행 중입니다. 정말 종료하시겠습니까?';
const UNSAVED_CLOSE = '저장되지 않은 로스트가 있습니다. 저장하지 않고 종료하시겠습니까?';

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

const tauri = vi.hoisted(() => {
    const closeListeners = new Set<CloseHandler>();
    return { closeListeners };
});

const dialog = vi.hoisted(() => ({
    ask: vi.fn((_message: string) => Promise.resolve(false)),
}));

const chart = vi.hoisted(() => ({
    containPixel: vi.fn(() => true),
    convertFromPixel: vi.fn(() => Number.NaN),
    convertToPixel: vi.fn(() => Number.NaN),
    dispose: vi.fn(),
    getDataURL: vi.fn(() => ''),
    getOption: vi.fn(() => ({})),
    getWidth: () => 800,
    getZr: () => ({
        off: vi.fn(),
        on: vi.fn(),
    }),
    off: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
}));

vi.mock('echarts', () => ({
    init: vi.fn(() => chart),
    graphic: { clipRectByRect: vi.fn(() => null) },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@entities/organization', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/organization')>();
    return {
        ...actual,
        useActiveWorkspace: () => ({ workspaceOwnerId: '' }),
    };
});

vi.mock('@features/active-roast/lib/alertSound', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@features/active-roast/lib/alertSound')>();
    return { ...actual, primeAlertAudio: () => undefined };
});

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        onCloseRequested: (handler: CloseHandler) => {
            tauri.closeListeners.add(handler);
            return Promise.resolve(() => {
                tauri.closeListeners.delete(handler);
            });
        },
        setTitle: () => Promise.resolve(),
    }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    ask: dialog.ask,
    message: vi.fn(() => Promise.resolve()),
}));

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: async () => undefined,
    settingsSet: async () => undefined,
    settingsFlush: async () => undefined,
    SETTINGS_STORE_FILE: 'settings.json',
    SETTINGS_SAVE_DEBOUNCE_MS: 200,
}));

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        waitUntilReady: () => new Promise(() => undefined),
        getStatus: vi.fn().mockResolvedValue({ connected: true, control: { writable: false, limits: {} } }),
        getTemperatures: vi.fn().mockResolvedValue({
            bt: null,
            et: null,
            ror: 0,
            ror_et: 0,
            heater: null,
            fan: 0,
            drum: 0,
        }),
        updateSettings: vi.fn().mockResolvedValue(undefined),
        startRoast: vi.fn().mockResolvedValue(undefined),
        resetRoast: vi.fn().mockResolvedValue({ ok: true }),
        enterStandby: vi.fn().mockResolvedValue(undefined),
        setControl: vi.fn().mockResolvedValue({ applied: {} }),
        pidOff: vi.fn().mockResolvedValue({ ok: true }),
        pidOn: vi.fn().mockResolvedValue({ ok: true }),
    },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalTick = useRoastingStore.getState().tick;
let tickCalls = 0;

const clockText = (host: HTMLElement) => host.querySelector('[data-testid="roast-time"]')?.textContent ?? '';

const seed = (patch: Partial<ReturnType<typeof useRoastingStore.getState>>) => {
    tickCalls = 0;
    const now = Date.now();
    useRoastingStore.setState({
        phase: 'roasting',
        sidecarConnected: true,
        sessionId: 'sess-remount',
        sessionOwnerId: 'owner',
        roastStartMs: now - 5_000,
        elapsed: 5,
        awaitingNextCharge: false,
        heatHoldAfterDrop: false,
        liveData: null,
        reconnecting: false,
        ...patch,
        tick: () => {
            tickCalls += 1;
            originalTick();
        },
    });
};

const advance = async (ms: number) => {
    await act(async () => {
        // Date is faked with the timer clock, so this moves Date.now() and the 1s interval together.
        await vi.advanceTimersByTimeAsync(ms);
    });
};

const flushMicrotasks = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('ActiveRoast running clock (#627)', () => {
    let host: HTMLDivElement;
    let root: Root;
    let queryClient: QueryClient;
    const mounted: Array<() => void> = [];

    const mount = () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        act(() => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: queryClient },
                    createElement(ActiveRoast, { isActive: true }),
                ),
            );
        });
        let alive = true;
        const unmount = () => {
            if (!alive) return;
            alive = false;
            act(() => root.unmount());
            host.remove();
            queryClient.clear();
        };
        mounted.push(unmount);
        return unmount;
    };

    const closeOnce = async () => {
        expect(tauri.closeListeners.size).toBe(1);
        const handler = [...tauri.closeListeners][0];
        const event = { preventDefault: vi.fn() };
        await act(async () => {
            await handler(event);
        });
        return event;
    };

    beforeEach(() => {
        useRoastingStore.getState().clear();
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        vi.setSystemTime(new Date('2026-09-28T03:00:00.000Z'));
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        );
        Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
        tauri.closeListeners.clear();
        dialog.ask.mockClear();
        dialog.ask.mockResolvedValue(false);
        _resetTsvWriterForTests({
            write: async () => undefined,
            remove: async () => undefined,
        });
        useBbpStore.getState().abort();
        useRoastingStore.getState().reset();
        mounted.length = 0;
    });

    afterEach(async () => {
        for (const unmount of mounted.splice(0)) unmount();
        await flushMicrotasks();
        useBbpStore.getState().abort();
        useRoastingStore.getState().reset();
        useRoastingStore.setState({ tick: originalTick });
        vi.unstubAllGlobals();
        vi.useRealTimers();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('runs the screen timer when a roasting session is already in the store, including remount', async () => {
        seed({});
        const timersBefore = vi.getTimerCount();
        const unmount = mount();
        await flushMicrotasks();

        expect(clockText(host)).toContain('0:05');
        expect(tauri.closeListeners.size).toBe(1);
        const timersMounted = vi.getTimerCount();
        expect(timersMounted).toBe(timersBefore + 1);

        await advance(1000);
        expect(tickCalls).toBe(1);
        expect(useRoastingStore.getState().elapsed).toBe(6);
        expect(clockText(host)).toContain('0:06');

        const runningClose = await closeOnce();
        expect(dialog.ask).toHaveBeenCalledWith(RUNNING_CLOSE, expect.objectContaining({ title: '로스팅 진행 중' }));
        expect(runningClose.preventDefault).toHaveBeenCalledTimes(1);

        unmount();
        await flushMicrotasks();
        expect(tauri.closeListeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(timersBefore);

        await advance(3000);
        expect(tickCalls).toBe(1);
        expect(useRoastingStore.getState().elapsed).toBe(6);

        mount();
        await flushMicrotasks();
        expect(tauri.closeListeners.size).toBe(1);
        expect(vi.getTimerCount()).toBe(timersMounted);
        expect(clockText(host)).toContain('0:06');

        // Wall clock moved while unmounted. One new timer catches up; it does not stack on the old one.
        await advance(1000);
        expect(tickCalls).toBe(2);
        expect(useRoastingStore.getState().elapsed).toBe(10);
        expect(clockText(host)).toContain('0:10');
    });

    it('does not stop the screen timer when the roaster disconnects during roasting', async () => {
        seed({ sidecarConnected: true });
        mount();
        await flushMicrotasks();
        await advance(1000);
        expect(useRoastingStore.getState().elapsed).toBe(6);

        act(() => {
            useRoastingStore.setState({ sidecarConnected: false });
        });
        expect(useRoastingStore.getState().phase).toBe('roasting');

        await advance(1000);
        expect(tickCalls).toBe(2);
        expect(useRoastingStore.getState().phase).toBe('roasting');
        expect(useRoastingStore.getState().elapsed).toBe(7);
        expect(useRoastingStore.getState().sessionId).toBe('sess-remount');
        expect(clockText(host)).toContain('0:07');
    });

    it('keeps the close warning for an unsaved Charge wait and for an ended batch', async () => {
        seed({
            phase: 'standby',
            awaitingNextCharge: true,
            elapsed: 600,
            roastStartMs: 0,
        });
        const unmountWait = mount();
        await flushMicrotasks();
        await advance(2000);
        expect(tickCalls).toBe(0);
        expect(useRoastingStore.getState().phase).toBe('standby');
        expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);

        const waitClose = await closeOnce();
        expect(dialog.ask).toHaveBeenCalledWith(UNSAVED_CLOSE, expect.objectContaining({ title: '로스팅 진행 중' }));
        expect(waitClose.preventDefault).toHaveBeenCalledTimes(1);
        unmountWait();
        await flushMicrotasks();

        dialog.ask.mockClear();
        seed({
            phase: 'standby',
            awaitingNextCharge: false,
            elapsed: 600,
            roastStartMs: 0,
        });
        useRoastingStore.getState().capture({
            sessionId: 'completed',
            sessionOwnerId: null,
            roastStartMs: 1000,
            elapsed: 600,
            logEntries: [],
            livePoints: [],
        });
        mount();
        await flushMicrotasks();
        const endedClose = await closeOnce();
        expect(dialog.ask).toHaveBeenCalledWith(UNSAVED_CLOSE, expect.objectContaining({ kind: 'warning' }));
        expect(endedClose.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('does not warn on close when nothing is roasting or unsaved', async () => {
        seed({
            phase: 'idle',
            awaitingNextCharge: false,
            sessionId: null,
            elapsed: 0,
            roastStartMs: 0,
        });
        mount();
        await flushMicrotasks();
        await advance(2000);
        expect(tickCalls).toBe(0);

        const event = await closeOnce();
        expect(dialog.ask).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });
});
