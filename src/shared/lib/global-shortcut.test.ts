// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { register, unregister } = vi.hoisted(() => ({
    register: vi.fn<(accelerator: string, handler: (event: { state: string }) => void) => Promise<void>>(
        async () => undefined,
    ),
    unregister: vi.fn<(accelerator: string) => Promise<void>>(async () => undefined),
}));

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register, unregister }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

const load = async () => {
    vi.resetModules();
    return import('./global-shortcut');
};

const markDesktop = () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
};

describe('shortcutToAccelerator', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('maps the binding to the plugin accelerator with a platform-neutral mod', async () => {
        const { shortcutToAccelerator } = await load();
        expect(shortcutToAccelerator('mod+shift+d')).toBe('CommandOrControl+Shift+D');
        expect(shortcutToAccelerator('mod+enter')).toBe('CommandOrControl+Enter');
        expect(shortcutToAccelerator('ctrl+alt+f4')).toBe('Control+Alt+F4');
        expect(shortcutToAccelerator('mod+left')).toBe('CommandOrControl+ArrowLeft');
        expect(shortcutToAccelerator('mod+,')).toBe('CommandOrControl+,');
        expect(shortcutToAccelerator('mod++')).toBe('CommandOrControl+Shift+Equal');
        expect(shortcutToAccelerator('mod+shift+%')).toBe('CommandOrControl+Shift+Digit5');
    });

    it('refuses unmodified and unparsable keys', async () => {
        const { shortcutToAccelerator } = await load();
        // A bare key registered globally would swallow plain typing in every other app.
        expect(shortcutToAccelerator('d')).toBeNull();
        expect(shortcutToAccelerator('shift+d')).toBeNull();
        expect(shortcutToAccelerator('mod+not-a-key')).toBeNull();
        expect(shortcutToAccelerator('')).toBeNull();
    });
});

describe('syncGlobalShortcuts', () => {
    beforeEach(() => {
        register.mockClear();
        unregister.mockClear();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('is a no-op outside the desktop webview', async () => {
        const { syncGlobalShortcuts } = await load();
        await syncGlobalShortcuts(new Map([['CommandOrControl+Shift+D', vi.fn()]]));
        expect(register).not.toHaveBeenCalled();
    });

    it('holds multiple keys and swaps only the changed binding', async () => {
        markDesktop();
        const { syncGlobalShortcuts } = await load();
        const onPress = vi.fn();
        const yellow = vi.fn();
        await syncGlobalShortcuts(
            new Map([
                ['CommandOrControl+Shift+D', onPress],
                ['CommandOrControl+1', yellow],
            ]),
        );
        expect(register).toHaveBeenCalledWith('CommandOrControl+Shift+D', expect.any(Function));
        expect(register).toHaveBeenCalledWith('CommandOrControl+1', expect.any(Function));
        const handler = register.mock.calls[0]?.[1];
        handler?.({ state: 'Pressed' });
        expect(onPress).toHaveBeenCalledTimes(1);
        handler?.({ state: 'Released' });
        expect(onPress).toHaveBeenCalledTimes(1);
        const latest = vi.fn();
        await syncGlobalShortcuts(
            new Map([
                ['CommandOrControl+Shift+D', latest],
                ['CommandOrControl+1', yellow],
            ]),
        );
        expect(register).toHaveBeenCalledTimes(2);
        handler?.({ state: 'Pressed' });
        expect(latest).toHaveBeenCalledTimes(1);
        expect(onPress).toHaveBeenCalledTimes(1);
        await syncGlobalShortcuts(
            new Map([
                ['CommandOrControl+Shift+E', latest],
                ['CommandOrControl+1', yellow],
            ]),
        );
        expect(unregister).toHaveBeenCalledWith('CommandOrControl+Shift+D');
        expect(register).toHaveBeenLastCalledWith('CommandOrControl+Shift+E', expect.any(Function));
        expect(register).toHaveBeenCalledTimes(3);
        handler?.({ state: 'Pressed' });
        expect(latest).toHaveBeenCalledTimes(1);
        await syncGlobalShortcuts(new Map());
        expect(unregister).toHaveBeenCalledWith('CommandOrControl+Shift+E');
        expect(unregister).toHaveBeenCalledWith('CommandOrControl+1');
    });

    it('keeps other keys working when Windows refuses one combination', async () => {
        markDesktop();
        register.mockRejectedValueOnce(new Error('already taken'));
        const { syncGlobalShortcuts } = await load();
        const yellow = vi.fn();
        await syncGlobalShortcuts(
            new Map([
                ['CommandOrControl+Shift+D', vi.fn()],
                ['CommandOrControl+1', yellow],
            ]),
        );
        register.mock.calls[1]?.[1]({ state: 'Pressed' });
        expect(yellow).toHaveBeenCalledTimes(1);
        await syncGlobalShortcuts(new Map());
        expect(unregister).not.toHaveBeenCalledWith('CommandOrControl+Shift+D');
    });

    it('disarms callbacks immediately when cleanup overtakes a pending registration', async () => {
        markDesktop();
        let finish: () => void = () => undefined;
        register.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        const { syncGlobalShortcuts } = await load();
        const onPress = vi.fn();
        const pending = syncGlobalShortcuts(new Map([['Control+Shift+D', onPress]]));
        await Promise.resolve();
        expect(register).toHaveBeenCalledTimes(1);
        const cleanup = syncGlobalShortcuts(new Map());
        register.mock.calls[0]?.[1]({ state: 'Pressed' });
        expect(onPress).not.toHaveBeenCalled();
        finish();
        await pending;
        await cleanup;
        expect(unregister).toHaveBeenCalledWith('Control+Shift+D');
    });

    it('retries a failed release without letting a stale key run an action', async () => {
        markDesktop();
        const { syncGlobalShortcuts } = await load();
        const onPress = vi.fn();
        await syncGlobalShortcuts(new Map([['Control+Shift+D', onPress]]));
        unregister.mockRejectedValueOnce(new Error('temporary failure'));
        await syncGlobalShortcuts(new Map());
        register.mock.calls[0]?.[1]({ state: 'Pressed' });
        expect(onPress).not.toHaveBeenCalled();
        await syncGlobalShortcuts(new Map());
        expect(unregister).toHaveBeenCalledTimes(2);
    });
});
