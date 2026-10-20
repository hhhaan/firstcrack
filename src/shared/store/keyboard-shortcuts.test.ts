// @vitest-environment jsdom

import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useHotkeys } from 'react-hotkeys-hook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

import {
    eventToShortcut,
    formatShortcut,
    hydrateShortcutBindings,
    parseShortcutBindings,
    SHORTCUT_HOTKEY_OPTIONS,
    shortcutHotkeys,
    useShortcutKeys,
    useShortcutStore,
} from './keyboard-shortcuts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('keyboard shortcuts', () => {
    beforeEach(() => {
        localStorage.clear();
        useShortcutStore.getState().resetBindings();
        vi.mocked(settingsGet).mockReset().mockResolvedValue(undefined);
        vi.mocked(settingsSet).mockClear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('validates conflicts, reserved keys, and fixed bindings', () => {
        expect(useShortcutStore.getState().setBinding('yellow', 'mod+2')).toBe('conflict');
        expect(useShortcutStore.getState().setBinding('yellow', 'ctrl+2')).toBe('conflict');
        expect(useShortcutStore.getState().setBinding('yellow', 'shift++')).toBe('conflict');
        expect(useShortcutStore.getState().setBinding('yellow', 'escape')).toBe('reserved');
        expect(useShortcutStore.getState().setBinding('yellow', 'tab')).toBe('reserved');
        expect(useShortcutStore.getState().setBinding('yellow', 'mod+shift+r')).toBe('reserved');
        expect(useShortcutStore.getState().setBinding('yellow', 'mod')).toBe('invalid');
        expect(useShortcutStore.getState().setBinding('yellow', 'space')).toBe('invalid');
        expect(useShortcutStore.getState().setBinding('exitFullscreen', 'x')).toBe('invalid');
        expect(useShortcutStore.getState().setBinding('yellow', 'mod+4')).toBeUndefined();
        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+4']);
    });

    it('falls back from malformed, reserved, and conflicting persisted bindings', () => {
        expect(
            parseShortcutBindings({
                yellow: ['mod+2'],
                fcEnd: ['tab'],
                drop: ['not-a-real-key'],
                exitFullscreen: ['x'],
                unknown: ['q'],
            }),
        ).toEqual({});

        expect(parseShortcutBindings({ yellow: ['mod+2'], fcStart: ['mod+1'] })).toEqual({
            yellow: ['mod+2'],
            fcStart: ['mod+1'],
        });
    });

    it('captures and formats canonical shortcuts', () => {
        expect(eventToShortcut({ key: ',', metaKey: true }, true)).toBe('mod+,');
        expect(eventToShortcut({ key: 'k', ctrlKey: true }, true)).toBe('ctrl+k');
        expect(eventToShortcut({ key: 'k', metaKey: true }, false)).toBe('');
        expect(eventToShortcut({ key: 'ArrowLeft' })).toBe('left');
        expect(eventToShortcut({ key: '+', shiftKey: true })).toBe('+');
        expect(eventToShortcut({ key: '+', shiftKey: true, metaKey: true }, true)).toBe('mod++');
        expect(eventToShortcut({ key: 'Shift', shiftKey: true })).toBe('');
        expect(formatShortcut(['mod+,', 'f'], true)).toBe('⌘, / F');
        expect(formatShortcut('mod++', true)).toBe('⌘+');
        expect(shortcutHotkeys(['mod+,', '+', 'mod+shift++', '>', '|'])).toBe(
            'mod\t,\n+\nshift\t+\nmod\tshift\t+\n>\n|',
        );
    });

    it.each([false, true])('registers comma, edited letters, and plus (Apple: %s)', (apple) => {
        vi.stubGlobal('navigator', {
            userAgent: apple ? 'Macintosh' : 'Windows',
            platform: apple ? 'MacIntel' : 'Win32',
        });
        const hit = vi.fn();
        const host = document.createElement('div');
        const root = createRoot(host);
        const Hotkey = ({ keys }: { keys: string[] }) => {
            useHotkeys(shortcutHotkeys(keys), hit, SHORTCUT_HOTKEY_OPTIONS);
            return null;
        };

        act(() => root.render(createElement(Hotkey, { keys: ['mod+,', 'x', '+'] })));
        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: ',', metaKey: apple, ctrlKey: !apple, bubbles: true }),
            );
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', shiftKey: true, bubbles: true }));
        });

        expect(hit).toHaveBeenCalledTimes(3);
        act(() => root.unmount());
    });

    it('hydrates from localStorage for missing settings values', async () => {
        const values = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        });
        localStorage.setItem('keyboard.bindings', JSON.stringify({ yellow: ['mod+4'] }));
        localStorage.setItem('keyboard.disabled', JSON.stringify(['yellow', 'unknown', true, 'yellow']));
        vi.mocked(settingsGet).mockResolvedValue(null as never);

        await hydrateShortcutBindings();

        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+4']);
        expect(useShortcutStore.getState().disabled).toEqual(['yellow']);
    });

    it('disables mounted hotkeys without losing their edited bindings, and restores defaults', () => {
        const hit = vi.fn();
        const root = createRoot(document.createElement('div'));
        const Hotkey = () => {
            const keys = useShortcutKeys('yellow');
            useHotkeys(shortcutHotkeys(keys), hit, { enabled: keys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS });
            return null;
        };
        const press = () =>
            act(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
                document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
            });
        useShortcutStore.getState().setBinding('yellow', 'x');
        act(() => root.render(createElement(Hotkey)));
        press();
        expect(hit).toHaveBeenCalledTimes(1);

        act(() => useShortcutStore.getState().setEnabled('yellow', false));
        press();
        expect(hit).toHaveBeenCalledTimes(1);
        expect(useShortcutStore.getState().bindings.yellow).toEqual(['x']);
        expect(settingsSet).toHaveBeenLastCalledWith('keyboard.disabled', ['yellow']);

        act(() => useShortcutStore.getState().setEnabled('yellow', true));
        press();
        expect(hit).toHaveBeenCalledTimes(2);

        act(() => {
            useShortcutStore.getState().setEnabled('yellow', false);
            useShortcutStore.getState().resetBindings();
        });
        expect(useShortcutStore.getState().disabled).toEqual([]);
        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+1']);
        act(() => root.unmount());
    });

    it('upgrades a stored Drop binding that is only the superseded default', async () => {
        vi.mocked(settingsGet).mockImplementation(async (key) =>
            key === 'keyboard.bindings' ? { drop: ['mod+d'], yellow: ['mod+5'] } : undefined,
        );
        await hydrateShortcutBindings();

        expect(useShortcutStore.getState().bindings.drop).toEqual(['mod+shift+d']);
        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+5']);
        expect(settingsSet).toHaveBeenCalledWith(
            'keyboard.bindings',
            expect.objectContaining({ drop: ['mod+shift+d'] }),
        );
        expect(settingsSet).toHaveBeenCalledWith('keyboard.bindingsVersion', 2);
    });

    it('keeps a Drop key the user records again after the upgrade ran', async () => {
        vi.mocked(settingsGet).mockImplementation(async (key) => {
            if (key === 'keyboard.bindings') return { drop: ['mod+d'] };
            if (key === 'keyboard.bindingsVersion') return 2;
            return undefined;
        });
        await hydrateShortcutBindings();

        expect(useShortcutStore.getState().bindings.drop).toEqual(['mod+d']);
        expect(settingsSet).not.toHaveBeenCalledWith('keyboard.bindings', expect.anything());
    });

    it('leaves a custom Drop binding untouched while upgrading', async () => {
        vi.mocked(settingsGet).mockImplementation(async (key) =>
            key === 'keyboard.bindings' ? { drop: ['mod+shift+e'] } : undefined,
        );
        await hydrateShortcutBindings();

        expect(useShortcutStore.getState().bindings.drop).toEqual(['mod+shift+e']);
        expect(settingsSet).toHaveBeenCalledWith('keyboard.bindingsVersion', 2);
    });

    it('ignores malformed saved toggle state', async () => {
        vi.mocked(settingsGet).mockImplementation(async (key) => (key === 'keyboard.disabled' ? { yellow: true } : {}));
        await hydrateShortcutBindings();
        expect(useShortcutStore.getState().disabled).toEqual([]);
    });

    it('does not overwrite a toggle changed while hydration is pending', async () => {
        let resolve!: (value: unknown) => void;
        vi.mocked(settingsGet).mockImplementationOnce(() => new Promise((done) => (resolve = done)) as never);
        const hydration = hydrateShortcutBindings();
        useShortcutStore.getState().setEnabled('yellow', false);
        resolve({});
        await hydration;
        expect(useShortcutStore.getState().disabled).toEqual(['yellow']);
    });

    it('does not overwrite an edit made while hydration is pending', async () => {
        let resolve!: (value: unknown) => void;
        vi.mocked(settingsGet).mockImplementationOnce(() => new Promise((done) => (resolve = done)) as never);
        const hydration = hydrateShortcutBindings();
        expect(useShortcutStore.getState().setBinding('yellow', 'mod+4')).toBeUndefined();
        resolve({ yellow: ['mod+5'] });

        await hydration;

        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+4']);
    });
});
