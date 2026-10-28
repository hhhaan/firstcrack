// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONITOR_REQUEST, MONITOR_SNAPSHOT, MONITOR_TIMEOUT_MS, type MonitorSnapshot } from '../lib/roast-monitor';
import { RoastMonitorView } from '../ui/RoastMonitor';
import { useRoastingStore } from './status';
import { useRoastMonitor } from './useRoastMonitor';
import { useRoastMonitorBridge } from './useRoastMonitorBridge';

const ipc = vi.hoisted(() => ({
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
    connected: true,
    invoke: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: ipc.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
    emitTo: async (_target: string, event: string, payload: unknown) => {
        if (ipc.connected) ipc.listeners.get(event)?.({ payload });
    },
}));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
            ipc.listeners.set(event, handler);
            return () => ipc.listeners.delete(event);
        },
    }),
}));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const snapshot: MonitorSnapshot = {
    sessionId: 'batch-1',
    bt: '198.4°C',
    et: '215.8°C',
    ror: '6.2',
    rorUnit: '°C/min',
    time: '8:42',
    phase: 'Development',
    phaseColor: 'var(--color-phase-development)',
    development: '1:24',
    dtr: '16.1%',
    bbpTime: null,
    connected: true,
    stale: false,
    canDrop: true,
    dropTime: null,
    language: 'en',
};

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
let container: HTMLDivElement;
const onDrop = vi.fn(() => useRoastingStore.setState({ phase: 'standby', sessionId: null }));
const onShowMain = vi.fn();

function Harness({ value }: { value: MonitorSnapshot }) {
    useRoastMonitorBridge({ snapshot: value, onDrop, onShowMain });
    const monitor = useRoastMonitor();
    return createElement(RoastMonitorView, { ...monitor, onDrop: monitor.drop, onShowMain: monitor.showMain });
}
const render = (value = snapshot) => act(async () => root.render(createElement(Harness, { value })));
const request = (payload: unknown) => act(async () => ipc.listeners.get(MONITOR_REQUEST)?.({ payload }));
const advance = (milliseconds: number) => act(async () => vi.advanceTimersByTime(milliseconds));
const dropButton = () => container.querySelector<HTMLButtonElement>('[data-testid="monitor-drop"]');

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ipc.connected = true;
    ipc.listeners.clear();
    useRoastingStore.setState({ phase: 'roasting', sessionId: snapshot.sessionId });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useRoastingStore.getState().reset();
    vi.useRealTimers();
});

describe('roast monitor', () => {
    it('omits permanent status badges and explanatory copy', async () => {
        await render();
        expect(container.querySelector('svg')).toBeNull();
        expect(container.textContent).not.toContain('activeRoast.phase.');
        for (const key of ['alwaysOnTop', 'live', 'recordOnly', 'reviewInMain']) {
            expect(container.textContent).not.toContain(`activeRoast.monitor.${key}`);
        }
    });

    it('omits an empty development row while preheating', async () => {
        await render({ ...snapshot, phase: 'PREHEATING', development: '—', dtr: '', canDrop: false });
        expect(container.textContent).not.toContain('activeRoast.monitor.development');
        expect(dropButton()?.disabled).toBe(true);
    });

    it.each(['READY', 'ENDED'])(
        'shows only the current BBP clock instead of the previous batch summary in %s',
        async (phase) => {
            await render({ ...snapshot, phase, time: '0:02', dropTime: '0:02', bbpTime: '2:33', canDrop: false });
            expect(container.querySelector('[data-testid="monitor-time"]')?.textContent).toBe('2:33');
            expect(container.textContent).toContain('BBP');
            expect(container.textContent).not.toContain('0:02');
            expect(container.textContent).not.toContain('activeRoast.monitor.development');
            expect(container.textContent).not.toContain('16.1%');
            expect(dropButton()).toBeNull();
            await render({ ...snapshot, phase, bbpTime: '2:34', canDrop: false });
            await advance(1000);
            expect(container.querySelector('[data-testid="monitor-time"]')?.textContent).toBe('2:34');
            await render();
            await advance(1000);
            expect(container.querySelector('[data-testid="monitor-time"]')?.textContent).toBe('8:42');
            expect(dropButton()?.disabled).toBe(false);
        },
    );

    it('loads the current readings immediately and follows subsequent snapshots', async () => {
        await render();
        expect(container.querySelector('[data-testid="monitor-bt"]')?.textContent).toBe('198.4°C');
        expect(container.querySelector('[data-testid="monitor-et"]')?.textContent).toBe('215.8°C');
        expect(container.querySelector('[data-testid="monitor-time"]')?.textContent).toBe('8:42');
        expect(dropButton()?.disabled).toBe(false);
        await render({ ...snapshot, bt: '202.1°C', time: '9:00' });
        await advance(1000);
        expect(container.querySelector('[data-testid="monitor-bt"]')?.textContent).toBe('202.1°C');
    });

    it('records Drop once through the main session and rejects queued duplicates', async () => {
        await render();
        await act(async () => {
            dropButton()?.click();
            dropButton()?.click();
        });
        await request({ type: 'drop', sessionId: 'batch-1' });
        expect(onDrop).toHaveBeenCalledOnce();
        expect(dropButton()?.disabled).toBe(true);
        await render({ ...snapshot, sessionId: null, canDrop: false, dropTime: '8:42' });
        await advance(1000);
        expect(dropButton()?.textContent).toContain('dropRecorded');
        expect(dropButton()?.textContent).toContain('8:42');
    });

    it('rejects malformed requests and requests for an earlier batch', async () => {
        await render();
        await request({ type: 'drop' });
        await request({ type: 'drop', sessionId: 'batch-0' });
        await request({ type: 'control', heater: 100 });
        expect(onDrop).not.toHaveBeenCalled();
    });

    it.each([{ canDrop: false }, { connected: false }, { stale: true }])(
        'blocks Drop when the main session is unavailable: %j',
        async (patch) => {
            await render({ ...snapshot, ...patch });
            await request({ type: 'drop', sessionId: 'batch-1' });
            expect(dropButton()?.disabled).toBe(true);
            expect(onDrop).not.toHaveBeenCalled();
        },
    );

    it.each(['standby', 'ended'] as const)(
        'checks the current store phase even before the next render: %s',
        async (phase) => {
            await render();
            useRoastingStore.setState({ phase });
            await request({ type: 'drop', sessionId: 'batch-1' });
            expect(onDrop).not.toHaveBeenCalled();
        },
    );

    it('hides old sensor readings and blocks Drop after heartbeat loss, then recovers', async () => {
        await render();
        ipc.connected = false;
        await advance(MONITOR_TIMEOUT_MS);
        expect(container.querySelector('[data-testid="monitor-bt"]')?.textContent).toBe('—');
        expect(container.querySelector('[data-testid="monitor-et"]')?.textContent).toBe('—');
        expect(dropButton()?.disabled).toBe(true);
        ipc.connected = true;
        await advance(1000);
        expect(container.querySelector('[data-testid="monitor-bt"]')?.textContent).toBe('198.4°C');
        expect(dropButton()?.disabled).toBe(false);
    });

    it('ignores an invalid snapshot without refreshing its heartbeat', async () => {
        await render();
        ipc.connected = false;
        await act(async () => ipc.listeners.get(MONITOR_SNAPSHOT)?.({ payload: { ...snapshot, canDrop: 'yes' } }));
        await advance(MONITOR_TIMEOUT_MS);
        expect(dropButton()?.disabled).toBe(true);
    });

    it('does not present an old sensor sample as live while the main window still responds', async () => {
        useRoastingStore.setState({
            liveData: {
                bt: 198.4,
                et: 210,
                ror: 6.2,
                ror_et: 0,
                heater: null,
                fan: 0,
                drum: 0,
                receivedAtMs: Date.now() - MONITOR_TIMEOUT_MS,
            },
        });
        await render();
        expect(container.querySelector('[data-testid="monitor-bt"]')?.textContent).toBe('—');
        expect(dropButton()?.disabled).toBe(true);
        await request({ type: 'drop', sessionId: 'batch-1' });
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('returns to the roast screen and restores focus to the main window', async () => {
        await render();
        await request({ type: 'show-main' });
        expect(onShowMain).toHaveBeenCalledOnce();
        expect(ipc.invoke).toHaveBeenCalledWith('show_roast_main');
    });

    it.each(['preheating', 'standby', 'roasting', 'ended'] as const)(
        'enables automatic monitoring for a connected machine in %s',
        async (phase) => {
            useRoastingStore.setState({ phase, sidecarConnected: true });
            await render();
            expect(ipc.invoke).toHaveBeenCalledWith('sync_roast_monitor', { enabled: true });
        },
    );

    it('keeps monitoring during a roast after a sensor disconnect', async () => {
        useRoastingStore.setState({ phase: 'roasting', sidecarConnected: false });
        await render();
        expect(ipc.invoke).toHaveBeenCalledWith('sync_roast_monitor', { enabled: true });
    });

    it('turns automatic monitoring off after disconnect when no batch is running', async () => {
        useRoastingStore.setState({ phase: 'standby', sidecarConnected: true });
        await render();
        await act(async () => useRoastingStore.setState({ phase: 'idle', sidecarConnected: false }));
        expect(ipc.invoke).toHaveBeenLastCalledWith('sync_roast_monitor', { enabled: false });
        const calls = ipc.invoke.mock.calls.length;
        await advance(1000);
        expect(ipc.invoke.mock.calls).toHaveLength(calls);
    });

    it('removes both listeners and the heartbeat on unmount', async () => {
        await render();
        await act(async () => root.render(null));
        expect(ipc.listeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(ipc.invoke).toHaveBeenLastCalledWith('sync_roast_monitor', { enabled: false });
    });
});
