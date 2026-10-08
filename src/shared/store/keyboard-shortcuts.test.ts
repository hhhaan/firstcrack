// @vitest-environment jsdom

import { settingsGet } from '@shared/lib/settings-store';
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
    useShortcutStore,
} from './keyboard-shortcuts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('keyboard shortcuts', () => {
    beforeEach(() => {
        useShortcutStore.getState().resetBindings();
        vi.mocked(settingsGet).mockReset().mockResolvedValue(undefined);
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
        vi.mocked(settingsGet).mockResolvedValue(null as never);

        await hydrateShortcutBindings();

        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+4']);
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
