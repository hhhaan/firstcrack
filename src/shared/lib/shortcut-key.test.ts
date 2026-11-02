import { describe, expect, it } from 'vitest';
import { canonicalShortcut, doubleShortcut, sameShortcut, shortcutBindingError, shortcutChord } from './shortcut-key';

describe('double shortcut bindings', () => {
    it('canonicalizes one chord written twice and rejects a mixed pair', () => {
        expect(canonicalShortcut('Shift+Enter Shift+Enter')).toBe('shift+enter shift+enter');
        expect(canonicalShortcut('shift+enter')).toBe('shift+enter');
        expect(canonicalShortcut('shift+enter shift+1')).toBe('');
        expect(shortcutChord('shift+enter shift+enter')).toBe('shift+enter');
        expect(doubleShortcut('Shift+Enter')).toBe('shift+enter shift+enter');
    });

    it('treats a single and a double of the same chord as a conflict', () => {
        expect(shortcutBindingError('shift+enter shift+enter', ['shift+enter'])).toBe('conflict');
        expect(shortcutBindingError('shift+enter', ['shift+enter shift+enter'])).toBe('conflict');
        expect(shortcutBindingError('shift+enter shift+enter', ['mod+1'])).toBeUndefined();
        expect(shortcutBindingError('escape escape', [])).toBe('reserved');
        expect(sameShortcut('shift+enter shift+enter', 'shift+enter')).toBe(false);
        expect(sameShortcut('Shift+Enter Shift+Enter', 'shift+enter shift+enter')).toBe(true);
    });
});
