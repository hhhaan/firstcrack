// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { globalDropSupport, nativeDropShortcut, nativeDropShortcuts } from './global-drop-native';

const tauri = (present: boolean) => {
    if (present) Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    else Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
};

afterEach(() => tauri(false));

it('maps app bindings to the code names global-hotkey parses', () => {
    expect(nativeDropShortcut('mod+d')).toBe('CommandOrControl+D');
    expect(nativeDropShortcut('ctrl+d')).toBe('Control+D');
    expect(nativeDropShortcut('alt+enter')).toBe('Alt+Enter');
    expect(nativeDropShortcut('mod+shift+1')).toBe('CommandOrControl+Shift+1');
    expect(nativeDropShortcut('mod+left')).toBe('CommandOrControl+ArrowLeft');
    expect(nativeDropShortcut('mod+f5')).toBe('CommandOrControl+F5');
    expect(nativeDropShortcut('mod+-')).toBe('CommandOrControl+-');
});

it.each([
    ['mod++', 'CommandOrControl+Shift+Equal'],
    ['mod+shift++', 'CommandOrControl+Shift+Equal'],
    ['ctrl+_', 'Control+Shift+Minus'],
    ['alt+?', 'Alt+Shift+Slash'],
    ['mod+shift+%', 'CommandOrControl+Shift+Digit5'],
    ['mod+,', 'CommandOrControl+,'],
])('encodes %s using native parser key codes', (binding, accelerator) => {
    expect(nativeDropShortcut(binding)).toBe(accelerator);
});

it('rejects combinations global-hotkey cannot grab', () => {
    expect(nativeDropShortcut('shift+d')).toBeNull();
    expect(nativeDropShortcut('d')).toBeNull();
});

it('reports support before a roast starts', () => {
    tauri(true);
    expect(nativeDropShortcuts(['mod+d'])).toEqual(['CommandOrControl+D']);
    expect(globalDropSupport(['mod+d'])).toBe('idle');
    expect(globalDropSupport(['shift+d'])).toBe('unsupported');
    expect(globalDropSupport([])).toBe('unsupported');
    tauri(false);
    expect(globalDropSupport(['mod+d'])).toBe('unsupported');
});
