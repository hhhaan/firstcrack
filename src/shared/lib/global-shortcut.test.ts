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
    });

    it('refuses unmodified and unparsable keys', async () => {
        const { shortcutToAccelerator } = await load();
        // A bare key registered globally would swallow plain typing in every other app.
        expect(shortcutToAccelerator('d')).toBeNull();
        expect(shortcutToAccelerator('mod+not-a-key')).toBeNull();
        expect(shortcutToAccelerator('')).toBeNull();
    });
});

describe('syncGlobalShortcut', () => {
    beforeEach(() => {
        register.mockClear();
        unregister.mockClear();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('is a no-op outside the desktop webview', async () => {
        const { syncGlobalShortcut } = await load();
        await expect(syncGlobalShortcut('CommandOrControl+Shift+D', () => undefined)).resolves.toBe(false);
        expect(register).not.toHaveBeenCalled();
    });

    it('holds one accelerator, releases it, and swaps without leaking the old one', async () => {
        markDesktop();
        const { syncGlobalShortcut } = await load();
        const onPress = vi.fn();

        await expect(syncGlobalShortcut('CommandOrControl+Shift+D', onPress)).resolves.toBe(true);
        expect(register).toHaveBeenCalledWith('CommandOrControl+Shift+D', expect.any(Function));

        const [accelerator, handler] = register.mock.calls[0] as unknown as [
            string,
            (event: { state: string }) => void,
        ];
        expect(accelerator).toBe('CommandOrControl+Shift+D');
        handler({ state: 'Pressed' });
        expect(onPress).toHaveBeenCalledTimes(1);
        // The plugin also reports the key release — that must not mark a second Drop.
        handler({ state: 'Released' });
        expect(onPress).toHaveBeenCalledTimes(1);

        // Re-registering the same accelerator is a no-op (StrictMode, re-renders).
        await expect(syncGlobalShortcut('CommandOrControl+Shift+D', onPress)).resolves.toBe(true);
        expect(register).toHaveBeenCalledTimes(1);

        await expect(syncGlobalShortcut('CommandOrControl+Shift+E', onPress)).resolves.toBe(true);
        expect(unregister).toHaveBeenCalledWith('CommandOrControl+Shift+D');
        expect(register).toHaveBeenLastCalledWith('CommandOrControl+Shift+E', expect.any(Function));

        await expect(syncGlobalShortcut(null, onPress)).resolves.toBe(false);
        expect(unregister).toHaveBeenLastCalledWith('CommandOrControl+Shift+E');
    });

    it('reports a refused registration instead of throwing', async () => {
        markDesktop();
        register.mockRejectedValueOnce(new Error('already taken'));
        const { syncGlobalShortcut } = await load();
        await expect(syncGlobalShortcut('CommandOrControl+Shift+D', () => undefined)).resolves.toBe(false);
    });
});
