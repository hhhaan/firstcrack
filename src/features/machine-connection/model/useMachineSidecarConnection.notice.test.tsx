// @vitest-environment jsdom
import type { Machine, SidecarStatus, TemperatureReading } from '@entities/machine';
import { useToastStore } from '@shared/store/toast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeRoastLink, resetMachineLinkNotice, setRoastLinkWatch } from '../lib/machineLinkNotice';
import { useMachineSidecarConnection } from './useMachineSidecarConnection';

const mocks = vi.hoisted(() => ({
    getTemperatures: vi.fn(),
    getStatus: vi.fn(),
    waitUntilReady: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    listen: vi.fn(() => Promise.resolve(() => {})),
    emitExplicitMachineDisconnect: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen,
}));

vi.mock('@shared/lib/explicitMachineDisconnect', () => ({
    emitExplicitMachineDisconnect: mocks.emitExplicitMachineDisconnect,
}));

vi.mock('@shared/lib/sidecar', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sidecar')>();
    return {
        ...actual,
        sidecar: {
            getTemperatures: mocks.getTemperatures,
            getStatus: mocks.getStatus,
            waitUntilReady: mocks.waitUntilReady,
            connect: mocks.connect,
            disconnect: mocks.disconnect,
        },
    };
});

const osNotification = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@shared/lib/osNotification', () => ({
    sendOsNotification: osNotification.send,
}));

const planMock = vi.hoisted(() => ({ plan: 'enterprise' }));

vi.mock('@shared/lib/features/useAccountPlan', () => ({
    useAccountPlan: () => planMock.plan,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = (over: Partial<SidecarStatus> = {}): SidecarStatus =>
    ({
        connected: true,
        reconnecting: false,
        roaster: 'virtual',
        display_name: 'Virtual',
        brand: 'Virtual',
        capabilities: [],
        uptime: 1,
        error: null,
        ...over,
    }) as SidecarStatus;

const temps = (over: Partial<TemperatureReading> = {}): TemperatureReading =>
    ({
        bt: 200,
        et: 180,
        ror: 0,
        ror_et: 0,
        heater: 0,
        fan: 0,
        drum: 0,
        timestamp: 1,
        stale: false,
        reconnecting: false,
        ...over,
    }) as TemperatureReading;

const machine = {
    id: 'm1',
    name: 'Virtual',
    roasterKey: 'virtual',
    displayName: 'Virtual',
    brand: 'Virtual',
    models: ['Virtual'],
    protocol: 'virtual',
    connectionParams: {},
    capabilities: [],
    pid: null,
    createdAt: '2026-01-01',
} satisfies Machine;

const clearToasts = () => {
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
};

beforeEach(() => {
    planMock.plan = 'enterprise';
    resetMachineLinkNotice();
    clearToasts();
    mocks.listen.mockResolvedValue(() => {});
    mocks.waitUntilReady.mockResolvedValue(status({ connected: false }));
    mocks.getStatus.mockResolvedValue(status());
    mocks.getTemperatures.mockResolvedValue(temps());
    mocks.disconnect.mockResolvedValue(status({ connected: false }));
    mocks.connect.mockResolvedValue(status({ connected: false, error: 'nope' }));
});

afterEach(() => {
    clearToasts();
    resetMachineLinkNotice();
    vi.useRealTimers();
    vi.clearAllMocks();
});

const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

const renderHook = (machines: Machine[] = [machine]) => {
    const api: { current: ReturnType<typeof useMachineSidecarConnection> | null } = { current: null };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        api.current = useMachineSidecarConnection({
            isActive: true,
            modalOpen: false,
            machines,
        });
        return null;
    };
    act(() => root.render(createElement(Probe)));
    return { root, api };
};

it('sends the migrated W60 key and saved connection settings to the sidecar', async () => {
    const { useMachines } = await import('@entities/machine');
    const previousStorage = localStorage.getItem('fc_machines');
    const previousMachines = useMachines.getState().machines;
    const saved = {
        ...machine,
        name: '퀘스트빈',
        roasterKey: 'giesen_standard',
        protocol: 's7',
        connectionParams: { host: '192.168.10.60', port: 102, rack: 0, slot: 0, bt_offset: 200 },
    };
    let rendered: ReturnType<typeof renderHook> | undefined;
    try {
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [saved] }, version: 0 }));
        await useMachines.persist.rehydrate();
        const machines = useMachines.getState().machines;
        const migrated = machines.find((entry) => entry.id === saved.id);
        expect(migrated?.roasterKey).toBe('giesen_w45a_w60a');
        if (!migrated) throw new Error('Migrated machine is missing');
        mocks.connect.mockResolvedValue(status({ roaster: 'giesen_w45a_w60a' }));
        mocks.getStatus.mockResolvedValue(status({ roaster: 'giesen_w45a_w60a' }));
        rendered = renderHook(machines);
        await flush();
        const api = rendered.api;
        await act(async () => {
            await api.current?.handleConnect(migrated);
        });
        expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('giesen_w45a_w60a', saved.connectionParams, saved.id);
        expect(api.current?.sidecarStatus?.roaster).toBe('giesen_w45a_w60a');
    } finally {
        const root = rendered?.root;
        if (root) act(() => root.unmount());
        useMachines.setState({ machines: previousMachines });
        if (previousStorage === null) localStorage.removeItem('fc_machines');
        else localStorage.setItem('fc_machines', previousStorage);
    }
});

it('does not open the sidecar for Giesen W45A / W60A unless the account is enterprise', async () => {
    planMock.plan = 'pro';
    const gated = { ...machine, roasterKey: 'giesen_w45a_w60a', name: 'W60' };
    const { root, api } = renderHook([gated]);
    try {
        await flush();
        await act(async () => {
            await api.current?.handleConnect(gated);
        });
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(api.current?.sidecarStatus).toMatchObject({
            connected: false,
            roaster: 'giesen_w45a_w60a',
            error: 'machines.enterpriseOnly',
        });
    } finally {
        act(() => root.unmount());
    }
});

it('does not toast when a machine has never connected', async () => {
    vi.useFakeTimers();
    const { root } = renderHook();
    try {
        await flush();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);
        expect(mocks.getTemperatures).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
    }
});

it('toasts when a connected machine drops and does not repeat after the toast closes', async () => {
    vi.useFakeTimers();
    mocks.waitUntilReady.mockResolvedValue(status({ connected: true }));
    const { root } = renderHook();
    try {
        await flush();
        expect(mocks.getTemperatures).toHaveBeenCalled();
        expect(useToastStore.getState().toasts).toHaveLength(0);

        mocks.getStatus.mockResolvedValue(status({ connected: false, error: 'lost' }));
        mocks.getTemperatures.mockResolvedValue(temps({ bt: null }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(1);

        const [toast] = useToastStore.getState().toasts;
        act(() => {
            if (toast) useToastStore.getState().dismiss(toast.id);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);
    } finally {
        act(() => root.unmount());
    }
});

it('does not toast when the user disconnects', async () => {
    vi.useFakeTimers();
    mocks.waitUntilReady.mockResolvedValue(status({ connected: true }));
    const { root, api } = renderHook();
    try {
        await flush();
        mocks.getStatus.mockResolvedValue(status({ connected: false }));
        mocks.getTemperatures.mockRejectedValue(new Error('closed'));
        await act(async () => {
            await api.current?.handleDisconnect();
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);
        expect(mocks.emitExplicitMachineDisconnect).toHaveBeenCalledOnce();
    } finally {
        act(() => root.unmount());
    }
});

it('does not clear the roast curve when disconnect did not release the link', async () => {
    mocks.disconnect.mockResolvedValue(status({ connected: true }));
    const { root, api } = renderHook();
    try {
        await flush();
        await act(async () => {
            await api.current?.handleDisconnect();
        });
        expect(mocks.emitExplicitMachineDisconnect).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
    }
});

it('does not toast while the first connect attempt is in progress or when it fails', async () => {
    vi.useFakeTimers();
    mocks.waitUntilReady.mockResolvedValue(status({ connected: false }));
    let finish = (_status: SidecarStatus) => {};
    mocks.connect.mockReturnValue(
        new Promise((resolve) => {
            finish = resolve;
        }),
    );
    const { root, api } = renderHook();
    try {
        await flush();
        let pending: Promise<SidecarStatus | null> | undefined;
        act(() => {
            pending = api.current?.handleConnect(machine);
        });
        mocks.getStatus.mockResolvedValue(status({ connected: false, error: 'timeout' }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);

        await act(async () => {
            finish(status({ connected: false, error: 'timeout' }));
            await pending;
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);
    } finally {
        act(() => root.unmount());
    }
});

it('toasts again after a live temperature recovers a fault streak', async () => {
    vi.useFakeTimers();
    mocks.waitUntilReady.mockResolvedValue(status({ connected: true }));
    mocks.getStatus.mockResolvedValue(status({ connected: true }));
    mocks.getTemperatures.mockRejectedValue(new Error('ERR_FAILED'));
    const { root } = renderHook();
    try {
        await flush();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(1);
        act(() => {
            for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
        });

        mocks.getTemperatures.mockResolvedValue(temps({ bt: 210, stale: false, timestamp: 10 }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);

        mocks.getTemperatures.mockRejectedValue(new Error('ERR_FAILED'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(1);
    } finally {
        act(() => root.unmount());
    }
});

it.each([999, 390, 0])('does not re-arm an open roast fault from a machines-page spike (%s°C)', async (bt) => {
    vi.useFakeTimers();
    mocks.waitUntilReady.mockResolvedValue(status());
    let { root } = renderHook();
    try {
        await flush();
        setRoastLinkWatch(true);
        for (let i = 0; i < 3; i++) observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(useToastStore.getState().toasts).toHaveLength(1);
        clearToasts();

        // Machines unmounts when another screen is selected; the notice baseline must survive.
        act(() => root.unmount());
        mocks.getTemperatures.mockResolvedValue(temps({ bt }));
        ({ root } = renderHook());
        await flush();
        for (let i = 0; i < 3; i++) observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(useToastStore.getState().toasts).toHaveLength(0);

        mocks.getTemperatures.mockResolvedValue(temps());
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        for (let i = 0; i < 3; i++) observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(useToastStore.getState().toasts).toHaveLength(1);
    } finally {
        act(() => root.unmount());
    }
});

it('marks sidecar ready after waitUntilReady resolves', async () => {
    mocks.waitUntilReady.mockResolvedValue(status({ connected: false }));
    const { root, api } = renderHook();
    try {
        await flush();
        expect(api.current?.sidecarReady).toBe(true);
    } finally {
        act(() => root.unmount());
    }
});

it('does not Sentry-capture opaque sidecar-down connect errors', async () => {
    const sentry = await import('@shared/lib/sentry');
    const captureSpy = vi.spyOn(sentry, 'captureActionable').mockImplementation(() => undefined);
    mocks.connect.mockRejectedValue(new TypeError('Load failed'));
    const { root, api } = renderHook();
    try {
        await flush();
        await act(async () => {
            await api.current?.handleConnect(machine);
        });
        expect(captureSpy).not.toHaveBeenCalled();
    } finally {
        captureSpy.mockRestore();
        act(() => root.unmount());
    }
});

it('shows sidecar validation text for connect 400 SidecarHttpError', async () => {
    const { SidecarHttpError } = await import('@shared/lib/sidecar');
    mocks.connect.mockRejectedValueOnce(new SidecarHttpError('/connect', 400, 'Serial port required', false));
    const { root, api } = renderHook();
    try {
        await flush();
        await act(async () => {
            await api.current?.handleConnect(machine);
        });
        expect(osNotification.send).toHaveBeenCalledWith('연결 오류', '「Virtual」Serial port required');
    } finally {
        act(() => root.unmount());
    }
});

it('Sentry-captures connect 401 but not validation 400', async () => {
    const { SidecarHttpError } = await import('@shared/lib/sidecar');
    const sentry = await import('@shared/lib/sentry');
    const captureSpy = vi.spyOn(sentry, 'captureActionable').mockImplementation(() => undefined);
    mocks.connect.mockRejectedValueOnce(new SidecarHttpError('/connect', 401, 'unauthorized', false));
    const { root, api } = renderHook();
    try {
        await flush();
        await act(async () => {
            await api.current?.handleConnect(machine);
        });
        expect(captureSpy).toHaveBeenCalledTimes(1);
        captureSpy.mockClear();
        mocks.connect.mockRejectedValueOnce(new SidecarHttpError('/connect', 400, 'Serial Port required', false));
        await act(async () => {
            await api.current?.handleConnect(machine);
        });
        expect(captureSpy).not.toHaveBeenCalled();
    } finally {
        captureSpy.mockRestore();
        act(() => root.unmount());
    }
});

it('toasts on the third temperature failure while status stays connected', async () => {
    vi.useFakeTimers();
    mocks.waitUntilReady.mockResolvedValue(status({ connected: true }));
    mocks.getTemperatures.mockRejectedValue(new Error('timeout'));
    mocks.getStatus.mockResolvedValue(status({ connected: true }));
    const { root } = renderHook();
    try {
        await flush();
        expect(useToastStore.getState().toasts).toHaveLength(0);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(0);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(useToastStore.getState().toasts).toHaveLength(1);
    } finally {
        act(() => root.unmount());
    }
});
