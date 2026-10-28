// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalDropShortcut } from './useGlobalDropShortcut';

const { register, unregister } = vi.hoisted(() => ({
    register: vi.fn<(accelerator: string, handler: (event: { state: string }) => void) => Promise<void>>(
        async () => undefined,
    ),
    unregister: vi.fn<(accelerator: string) => Promise<void>>(async () => undefined),
}));

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register, unregister }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = { enabled: boolean; keys: readonly string[]; onFire: () => void };

const renderShortcut = async (props: Props) => {
    const root = createRoot(document.createElement('div'));
    let latest = false;
    const Probe = (next: Props) => {
        latest = useGlobalDropShortcut(next);
        return null;
    };
    await act(async () => {
        root.render(createElement(Probe, props));
    });
    return {
        held: () => latest,
        update: (next: Props) =>
            act(async () => {
                root.render(createElement(Probe, next));
            }),
        unmount: () =>
            act(async () => {
                root.unmount();
            }),
    };
};

const pressGlobalShortcut = (state: 'Pressed' | 'Released' = 'Pressed') => {
    const last = register.mock.calls[register.mock.calls.length - 1];
    last?.[1]?.({ state });
};

describe('useGlobalDropShortcut', () => {
    afterEach(() => vi.restoreAllMocks());

    beforeEach(() => {
        register.mockClear();
        unregister.mockClear();
        Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    });

    it('holds the OS-level key only while Drop is markable', async () => {
        const onFire = vi.fn();
        const shortcut = await renderShortcut({ enabled: false, keys: ['mod+shift+d'], onFire });
        expect(shortcut.held()).toBe(false);
        expect(register).not.toHaveBeenCalled();

        await shortcut.update({ enabled: true, keys: ['mod+shift+d'], onFire });
        expect(shortcut.held()).toBe(true);
        expect(register).toHaveBeenCalledWith('CommandOrControl+Shift+D', expect.any(Function));

        pressGlobalShortcut();
        expect(onFire).toHaveBeenCalledTimes(1);

        await shortcut.update({ enabled: false, keys: ['mod+shift+d'], onFire });
        expect(shortcut.held()).toBe(false);
        expect(unregister).toHaveBeenLastCalledWith('CommandOrControl+Shift+D');
        await shortcut.unmount();
    });

    it('calls the latest handler, not the one captured at registration', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const shortcut = await renderShortcut({ enabled: true, keys: ['mod+shift+d'], onFire: first });
        await shortcut.update({ enabled: true, keys: ['mod+shift+d'], onFire: second });

        pressGlobalShortcut();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        await shortcut.unmount();
    });

    it('keeps Drop registered and receives native presses while the document is hidden or unfocused', async () => {
        const onFire = vi.fn();
        const shortcut = await renderShortcut({ enabled: true, keys: ['mod+shift+d'], onFire });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));

        expect(unregister).not.toHaveBeenCalled();
        pressGlobalShortcut();
        expect(onFire).toHaveBeenCalledTimes(1);
        await shortcut.unmount();
    });

    it('leaves multi-binding and unregisterable keys on the webview hotkey path', async () => {
        const onFire = vi.fn();
        const multi = await renderShortcut({ enabled: true, keys: ['mod+shift+d', 'mod+shift+e'], onFire });
        expect(multi.held()).toBe(false);
        await multi.unmount();

        const bare = await renderShortcut({ enabled: true, keys: ['d'], onFire });
        expect(bare.held()).toBe(false);
        expect(register).not.toHaveBeenCalled();
        await bare.unmount();
    });

    it('falls back to the webview hotkey when the OS refuses the key', async () => {
        register.mockRejectedValueOnce(new Error('already taken'));
        const shortcut = await renderShortcut({ enabled: true, keys: ['mod+shift+d'], onFire: vi.fn() });
        expect(shortcut.held()).toBe(false);
        await shortcut.unmount();
    });

    it('releases the key on unmount', async () => {
        const shortcut = await renderShortcut({ enabled: true, keys: ['mod+shift+d'], onFire: vi.fn() });
        expect(shortcut.held()).toBe(true);
        await shortcut.unmount();
        expect(unregister).toHaveBeenCalledWith('CommandOrControl+Shift+D');
    });
});
