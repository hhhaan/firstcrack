// @vitest-environment jsdom
import { useGlobalDropShortcutStore } from '@shared/store/global-drop-shortcut';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useGlobalDropShortcut } from './useGlobalDropShortcut';

const native = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }));
vi.mock('@tauri-apps/plugin-global-shortcut', () => native);
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const keys = ['mod+d'];
afterEach(() => {
    useGlobalDropShortcutStore.setState({ enabled: false, status: 'idle' });
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.useRealTimers();
    vi.clearAllMocks();
});
it.each([
    ['mod+d', 'CommandOrControl+D'],
    ['mod++', 'CommandOrControl+Shift+Equal'],
])('registers %s, owns presses once, and unregisters on phase exit', async (binding, accelerator) => {
    const activeKeys = [binding];
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    native.register.mockResolvedValue(undefined);
    native.unregister.mockResolvedValue(undefined);
    useGlobalDropShortcutStore.setState({ enabled: true });
    const drop = vi.fn();
    let owns!: { current: boolean };
    const Probe = ({ eligible }: { eligible: boolean }) => {
        owns = useGlobalDropShortcut(activeKeys, eligible, drop);
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { eligible: true })));
        expect(owns.current).toBe(true);
        expect(native.register).toHaveBeenCalledWith([accelerator], expect.any(Function));
        const send = (state: string) => native.register.mock.calls[0][1]({ shortcut: accelerator, state });
        act(() => {
            send('Pressed');
            send('Pressed');
        });
        expect(drop).not.toHaveBeenCalled();
        act(() => {
            send('Released');
            send('Pressed');
            send('Pressed');
        });
        expect(drop).toHaveBeenCalledTimes(1);
        await act(async () => root.render(createElement(Probe, { eligible: false })));
        expect(native.unregister).toHaveBeenCalledWith([accelerator]);
        expect(owns.current).toBe(false);
        act(() => {
            send('Released');
            send('Pressed');
            send('Released');
            send('Pressed');
        });
        expect(drop).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => root.unmount());
    }
});
it('returns ownership to the local binding if the OS rejects registration', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    native.register.mockRejectedValueOnce(new Error('conflict'));
    useGlobalDropShortcutStore.setState({ enabled: true });
    let owns!: { current: boolean };
    const Probe = ({ eligible }: { eligible: boolean }) => {
        owns = useGlobalDropShortcut(keys, eligible, vi.fn());
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { eligible: true })));
        expect(owns.current).toBe(false);
        expect(useGlobalDropShortcutStore.getState().status).toBe('failed');
        await act(async () => root.render(createElement(Probe, { eligible: false })));
        expect(useGlobalDropShortcutStore.getState().status).toBe('failed');
    } finally {
        await act(async () => root.unmount());
    }
});
it('cleans up a registration that resolves after unmount', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    let resolve!: () => void;
    native.register.mockImplementationOnce(
        () =>
            new Promise<void>((r) => {
                resolve = r;
            }),
    );
    native.unregister.mockResolvedValue(undefined);
    useGlobalDropShortcutStore.setState({ enabled: true });
    const Probe = () => {
        useGlobalDropShortcut(keys, true, vi.fn());
        return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
        root.unmount();
        resolve();
    });
    expect(native.unregister).toHaveBeenCalledWith(['CommandOrControl+D']);
});
it('stops waiting for a grab that never settles so the foreground shortcut returns', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.useFakeTimers();
    native.register.mockImplementationOnce(() => new Promise<void>(() => undefined));
    native.unregister.mockRejectedValue(new Error('not registered'));
    useGlobalDropShortcutStore.setState({ enabled: true });
    let owns!: { current: boolean };
    const Probe = () => {
        owns = useGlobalDropShortcut(keys, true, vi.fn());
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe)));
        expect(owns.current).toBe(true);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(owns.current).toBe(false);
        expect(useGlobalDropShortcutStore.getState().status).toBe('failed');
    } finally {
        await act(async () => root.unmount());
        vi.useRealTimers();
    }
});

it('releases foreground ownership before a stalled unregister and bounds the cleanup queue', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.useFakeTimers();
    native.register.mockImplementationOnce(() => new Promise<void>(() => undefined));
    native.unregister.mockImplementation(() => new Promise<void>(() => undefined));
    useGlobalDropShortcutStore.setState({ enabled: true });
    let owns!: { current: boolean };
    const Probe = () => {
        owns = useGlobalDropShortcut(keys, true, vi.fn());
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe)));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(owns.current).toBe(false);
        expect(useGlobalDropShortcutStore.getState().status).toBe('failed');
    } finally {
        await act(async () => {
            root.unmount();
            await vi.advanceTimersByTimeAsync(9000);
        });
        vi.useRealTimers();
    }
});

it('does not let late cleanup remove a replacement registration of the same key', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.useFakeTimers();
    let resolveFirst!: () => void;
    native.register
        .mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveFirst = resolve;
                }),
        )
        .mockResolvedValue(undefined);
    native.unregister.mockResolvedValue(undefined);
    useGlobalDropShortcutStore.setState({ enabled: true });
    let owns!: { current: boolean };
    const drop = vi.fn();
    const Probe = ({ eligible }: { eligible: boolean }) => {
        owns = useGlobalDropShortcut(keys, eligible, drop);
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { eligible: true })));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        await act(async () => root.render(createElement(Probe, { eligible: false })));
        await act(async () => root.render(createElement(Probe, { eligible: true })));
        expect(owns.current).toBe(true);
        expect(native.register).toHaveBeenCalledTimes(2);
        native.unregister.mockClear();
        await act(async () => resolveFirst());
        expect(native.unregister).not.toHaveBeenCalled();
        const send = (state: string) => native.register.mock.calls[1][1]({ shortcut: 'CommandOrControl+D', state });
        act(() => {
            send('Pressed');
            send('Released');
            send('Pressed');
        });
        expect(drop).toHaveBeenCalledTimes(1);
    } finally {
        await act(async () => root.unmount());
        vi.useRealTimers();
    }
});
