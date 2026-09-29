// @vitest-environment jsdom
/**
 * Browser CDP analogue: Active Roast stays mounted but inactive, Machines is Live,
 * GET /temperatures fails, GET /status stays connected. The last BT remains on screen.
 */
import type { Machine, SidecarStatus, TemperatureReading } from '@entities/machine';
import { useRoastingStore } from '@features/active-roast/model/status';
import { resetMachineLinkNotice, setRoastLinkWatch } from '@features/machine-connection/lib/machineLinkNotice';
import { useMachineSidecarConnection } from '@features/machine-connection/model/useMachineSidecarConnection';
import { useToastStore } from '@shared/store/toast';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSidecarPolling } from '../active-roast/model/useSidecarPolling';

const mocks = vi.hoisted(() => ({
    getTemperatures: vi.fn(),
    getStatus: vi.fn(),
    waitUntilReady: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    listen: vi.fn(() => Promise.resolve(() => {})),
    initSessionTsv: vi.fn(),
    enqueueTsvRow: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen,
}));

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getTemperatures: mocks.getTemperatures,
        getStatus: mocks.getStatus,
        waitUntilReady: mocks.waitUntilReady,
        connect: mocks.connect,
        disconnect: mocks.disconnect,
    },
}));

vi.mock('@shared/lib/osNotification', () => ({
    sendOsNotification: vi.fn(),
}));

vi.mock('@shared/lib/tsv-writer', () => ({
    enqueueTsvRow: mocks.enqueueTsvRow,
    initSessionTsv: mocks.initSessionTsv,
    writeBbpTsv: vi.fn(),
    deleteBbpTsv: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = (over: Partial<SidecarStatus> = {}): SidecarStatus =>
    ({
        connected: true,
        reconnecting: false,
        roaster: 'virtual',
        display_name: 'Virtual',
        brand: 'Virtual',
        capabilities: ['heater'],
        uptime: 12.4,
        error: null,
        ...over,
    }) as SidecarStatus;

const temps = (over: Partial<TemperatureReading> = {}): TemperatureReading =>
    ({
        bt: 210,
        et: 230,
        ror: 0,
        ror_et: 0,
        heater: 0,
        fan: 0,
        drum: 0,
        timestamp: 10,
        stale: false,
        reconnecting: false,
        ...over,
    }) as TemperatureReading;

const machine = {
    id: 'm1',
    name: 'Virtual Machine',
    roasterKey: 'virtual',
    displayName: 'Virtual Machine',
    brand: 'Virtual',
    models: ['Virtual'],
    protocol: 'virtual',
    connectionParams: {},
    capabilities: [],
    pid: null,
    createdAt: '2026-01-01',
} satisfies Machine;

const toastCount = () => useToastStore.getState().toasts.length;

const clearToasts = () => {
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
};

beforeEach(() => {
    resetMachineLinkNotice();
    clearToasts();
    useRoastingStore.getState().reset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    mocks.listen.mockResolvedValue(() => {});
    mocks.waitUntilReady.mockResolvedValue(status());
    mocks.getStatus.mockResolvedValue(status());
    mocks.getTemperatures.mockResolvedValue(temps());
    mocks.initSessionTsv.mockResolvedValue(undefined);
});

afterEach(() => {
    clearToasts();
    resetMachineLinkNotice();
    vi.useRealTimers();
    vi.clearAllMocks();
    useRoastingStore.getState().reset();
});

const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

const renderBoth = () => {
    const api: { current: ReturnType<typeof useMachineSidecarConnection> | null } = { current: null };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        const phase = useRoastingStore((s) => s.phase);
        useSidecarPolling({
            isActive: false,
            phase,
            pollIntervalMs: 500,
            enterPreheating: useRoastingStore.getState().enterPreheating,
            setConnected: useRoastingStore.getState().setConnected,
            roastStartTimeRef: { current: 0 },
            sessionId: null,
        });
        api.current = useMachineSidecarConnection({
            isActive: true,
            modalOpen: false,
            machines: [machine],
        });
        return null;
    };
    act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
    return { root, api };
};

it('toasts on the third temperature failure while status stays connected and the last Live BT remains, then again after a repeated clock', async () => {
    vi.useFakeTimers();
    const { root, api } = renderBoth();
    try {
        await flush();
        expect(api.current?.temps?.bt).toBe(210);
        expect(toastCount()).toBe(0);

        // Same handoff Machines performs after a successful connect.
        // Opening Active Roast leaves roastWatch set after you return here.
        // That flag must not swallow this page's 3s temperature failures.
        act(() => {
            useRoastingStore.getState().enterPreheating(['heater']);
            setRoastLinkWatch(true);
        });
        await flush();

        const callsAtArm = mocks.getTemperatures.mock.calls.length;
        mocks.getTemperatures.mockRejectedValue(new TypeError('Failed to fetch'));
        // The arming poll already succeeded. The next two 3s ticks are not enough.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });
        expect(toastCount()).toBe(0);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(mocks.getTemperatures.mock.calls.length - callsAtArm).toBe(3);
        expect(toastCount()).toBe(1);
        expect(api.current?.temps?.bt).toBe(210);
        expect(api.current?.sidecarStatus?.connected).toBe(true);
        expect(useRoastingStore.getState().phase).toBe('preheating');

        act(() => clearToasts());
        mocks.getTemperatures.mockResolvedValue(temps({ bt: 210, timestamp: 10, stale: false }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(toastCount()).toBe(0);
        expect(api.current?.temps?.bt).toBe(210);

        mocks.getTemperatures.mockRejectedValue(new TypeError('Failed to fetch'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });
        expect(toastCount()).toBe(0);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(toastCount()).toBe(1);
        expect(api.current?.temps?.bt).toBe(210);
        expect(useRoastingStore.getState().phase).toBe('preheating');
    } finally {
        act(() => root.unmount());
    }
});
