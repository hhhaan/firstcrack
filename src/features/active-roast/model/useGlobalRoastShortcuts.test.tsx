// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGlobalRoastShortcuts } from './useGlobalRoastShortcuts';

const { register, unregister } = vi.hoisted(() => ({
    register: vi.fn<(accelerator: string, handler: (event: { state: string }) => void) => Promise<void>>(
        async () => undefined,
    ),
    unregister: vi.fn<(accelerator: string) => Promise<void>>(async () => undefined),
}));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register, unregister }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Shortcuts = Parameters<typeof useGlobalRoastShortcuts>[0];

async function renderShortcuts(shortcuts: Shortcuts) {
    const root = createRoot(document.createElement('div'));
    let fire: ReturnType<typeof useGlobalRoastShortcuts> = () => undefined;
    const Probe = ({ shortcuts }: { shortcuts: Shortcuts }) => {
        fire = useGlobalRoastShortcuts(shortcuts);
        return null;
    };
    const update = (next: Shortcuts) => act(async () => root.render(createElement(Probe, { shortcuts: next })));
    await update(shortcuts);
    return {
        fire: (id: string) => fire(id),
        update,
        unmount: () => act(async () => root.unmount()),
    };
}

const press = (accelerator: string, state = 'Pressed') => {
    const handler = register.mock.calls.find(([key]) => key === accelerator)?.[1];
    expect(handler).toBeDefined();
    handler?.({ state });
};

beforeEach(() => {
    register.mockClear();
    unregister.mockClear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

it('receives multiple bindings while the webview document is hidden or unfocused', async () => {
    const onFire = vi.fn();
    const view = await renderShortcuts([{ id: 'drop', keys: ['mod+shift+d', 'alt+d'], enabled: true, onFire }]);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    press('CommandOrControl+Shift+D');
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(unregister).not.toHaveBeenCalled();
    await view.unmount();
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Shift+D');
    expect(unregister).toHaveBeenCalledWith('Alt+D');
});

it('dedupes local/native delivery per action and accepts the next physical press', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const drop = vi.fn();
    const yellow = vi.fn();
    const view = await renderShortcuts([
        { id: 'drop', keys: ['mod+shift+d'], enabled: true, onFire: drop },
        { id: 'yellow', keys: ['mod+1'], enabled: true, onFire: yellow },
    ]);
    press('CommandOrControl+Shift+D');
    view.fire('drop');
    view.fire('yellow');
    press('CommandOrControl+1');
    press('CommandOrControl+Shift+D', 'Released');
    expect(drop).toHaveBeenCalledTimes(1);
    expect(yellow).toHaveBeenCalledTimes(1);
    now += 150;
    press('CommandOrControl+Shift+D');
    expect(drop).toHaveBeenCalledTimes(2);
    await view.unmount();
});

it('uses the latest callback without releasing unchanged keys', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = await renderShortcuts([{ id: 'drop', keys: ['mod+shift+d'], enabled: true, onFire: first }]);
    await view.update([{ id: 'drop', keys: ['mod+shift+d'], enabled: true, onFire: second }]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(unregister).not.toHaveBeenCalled();
    press('CommandOrControl+Shift+D');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await view.unmount();
});

it('disarms events on disable and keeps saved-curve review and bare keys local', async () => {
    const onFire = vi.fn();
    const view = await renderShortcuts([{ id: 'drop', keys: ['mod+shift+d'], enabled: true, onFire }]);
    await view.update([
        { id: 'drop', keys: ['mod+shift+d'], enabled: false, onFire },
        { id: 'yellow', keys: ['mod+1'], enabled: true, global: false, onFire },
        { id: 'custom', keys: ['d'], enabled: true, onFire },
    ]);
    press('CommandOrControl+Shift+D');
    view.fire('drop');
    expect(onFire).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Shift+D');
    view.fire('yellow');
    view.fire('custom');
    expect(onFire).toHaveBeenCalledTimes(2);
    await view.unmount();
});

it('preserves form-field guards in the focused window and accepts background events', async () => {
    const yellow = vi.fn();
    const drop = vi.fn();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const view = await renderShortcuts([
        { id: 'yellow', keys: ['mod+1'], enabled: true, onFire: yellow },
        { id: 'drop', keys: ['mod+shift+d'], enabled: true, enableOnFormTags: true, onFire: drop },
    ]);
    press('CommandOrControl+1');
    press('CommandOrControl+Shift+D');
    expect(yellow).not.toHaveBeenCalled();
    expect(drop).toHaveBeenCalledTimes(1);
    hasFocus.mockReturnValue(false);
    press('CommandOrControl+1');
    expect(yellow).toHaveBeenCalledTimes(1);
    await view.unmount();
    input.remove();
});
