// @vitest-environment jsdom
import { useShortcutStore } from '@shared/store/keyboard-shortcuts';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRoastKeyboardShortcuts } from './useRoastKeyboardShortcuts';

const { register, unregister } = vi.hoisted(() => ({
    register: vi.fn<(accelerator: string, handler: (event: { state: string }) => void) => Promise<void>>(
        async () => undefined,
    ),
    unregister: vi.fn<(accelerator: string) => Promise<void>>(async () => undefined),
}));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register, unregister }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: async () => undefined,
    settingsSet: async () => undefined,
}));
vi.mock('./settings', () => ({
    useRoastSettings: () => ({
        eventButtons: { custom: [{ id: 'custom-1', name: 'Custom', enabled: true, shortcut: 'mod+4' }] },
    }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Props = Parameters<typeof useRoastKeyboardShortcuts>[0];

function props(overrides: Partial<Props> = {}): Props {
    return {
        isActive: true,
        isFullscreen: false,
        showEndRoastModal: false,
        showSummaryModal: false,
        showContinueModal: false,
        phase: 'roasting',
        awaitingNextCharge: false,
        onToggleFullscreen: vi.fn(),
        onExitFullscreen: vi.fn(),
        onEnterStandby: vi.fn(),
        onManualCharge: vi.fn(),
        onMarkEvent: vi.fn(),
        onCycleFc: vi.fn(),
        onMarkDrop: vi.fn(),
        ...overrides,
    };
}

async function renderShortcuts(initial: Props) {
    const root = createRoot(document.createElement('div'));
    const Probe = (next: Props) => {
        useRoastKeyboardShortcuts(next);
        return null;
    };
    const update = (next: Props) => act(async () => root.render(createElement(Probe, next)));
    await update(initial);
    return { update, unmount: () => act(async () => root.unmount()) };
}

function press(accelerator: string) {
    const handler = register.mock.calls.find(([key]) => key === accelerator)?.[1];
    expect(handler).toBeDefined();
    handler?.({ state: 'Pressed' });
}

beforeEach(() => {
    register.mockClear();
    unregister.mockClear();
    useShortcutStore.setState({ recording: false, dialogOpen: false, disabled: [] });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

it('routes every roast event through the native registration without window focus', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const actions = props();
    const view = await renderShortcuts(actions);
    press('CommandOrControl+1');
    press('CommandOrControl+2');
    press('CommandOrControl+3');
    press('CommandOrControl+4');
    press('CommandOrControl+Shift+D');
    expect(actions.onMarkEvent).toHaveBeenCalledWith('Yellow', 'Color change visible', 'Mark Yellow');
    expect(actions.onCycleFc).toHaveBeenCalledTimes(1);
    expect(actions.onMarkEvent).toHaveBeenCalledWith('FC End', 'First crack ended', 'Mark FC End');
    expect(actions.onMarkEvent).toHaveBeenCalledWith('Custom', '', 'custom-1');
    expect(actions.onMarkDrop).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(5);
    await view.unmount();
});

it('keeps preparation and Charge global only in their respective phases', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const actions = props({ phase: 'preheating' });
    const view = await renderShortcuts(actions);
    expect(register).toHaveBeenCalledTimes(1);
    press('CommandOrControl+Enter');
    expect(actions.onEnterStandby).toHaveBeenCalledTimes(1);
    expect(actions.onManualCharge).not.toHaveBeenCalled();
    await view.update({ ...actions, phase: 'standby', showSummaryModal: true });
    now += 200;
    press('CommandOrControl+Enter');
    expect(actions.onManualCharge).toHaveBeenCalledTimes(1);
    await view.update({ ...actions, phase: 'roasting' });
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Enter');
    await view.unmount();
});

it('records once when the same Windows key arrives through native and DOM paths', async () => {
    const actions = props();
    const view = await renderShortcuts(actions);
    await act(async () => {
        press('CommandOrControl+2');
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true }),
        );
        document.dispatchEvent(new KeyboardEvent('keyup', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true }));
    });
    expect(actions.onCycleFc).toHaveBeenCalledTimes(1);
    await view.unmount();
});

it('keeps local marking available when the OS refuses a global key, and ignores repeat', async () => {
    register.mockRejectedValueOnce(new Error('already registered by another application'));
    const actions = props();
    const view = await renderShortcuts(actions);
    await act(async () => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: '1', code: 'Digit1', ctrlKey: true, bubbles: true }),
        );
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: '1', code: 'Digit1', ctrlKey: true, repeat: true, bubbles: true }),
        );
        document.dispatchEvent(new KeyboardEvent('keyup', { key: '1', code: 'Digit1', ctrlKey: true, bubbles: true }));
    });
    expect(actions.onMarkEvent).toHaveBeenCalledExactlyOnceWith('Yellow', 'Color change visible', 'Mark Yellow');
    await view.unmount();
});

it.each(['showEndRoastModal', 'showSummaryModal', 'showContinueModal'] as const)(
    'releases roast event keys while %s is open',
    async (modal) => {
        const actions = props();
        const view = await renderShortcuts(actions);
        await view.update({ ...actions, [modal]: true });
        expect(unregister).toHaveBeenCalledTimes(5);
        press('CommandOrControl+1');
        press('CommandOrControl+Shift+D');
        expect(actions.onMarkEvent).not.toHaveBeenCalled();
        expect(actions.onMarkDrop).not.toHaveBeenCalled();
        await view.unmount();
    },
);
