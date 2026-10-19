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
    vi.clearAllMocks();
});
it('owns foreground/background presses once, ignores held keys, and unregisters on phase exit', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    native.register.mockResolvedValue(undefined);
    native.unregister.mockResolvedValue(undefined);
    useGlobalDropShortcutStore.setState({ enabled: true });
    const drop = vi.fn();
    let owns!: { current: boolean };
    const Probe = ({ eligible }: { eligible: boolean }) => {
        owns = useGlobalDropShortcut(keys, eligible, drop);
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { eligible: true })));
        expect(owns.current).toBe(true);
        expect(native.register).toHaveBeenCalledWith('CommandOrControl+D', expect.any(Function));
        const send = (state: string) => native.register.mock.calls[0][1]({ shortcut: 'CommandOrControl+D', state });
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
        expect(native.unregister).toHaveBeenCalledWith(['CommandOrControl+D']);
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
    const Probe = () => {
        owns = useGlobalDropShortcut(keys, true, vi.fn());
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe)));
        expect(owns.current).toBe(false);
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
