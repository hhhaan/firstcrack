import { describe, expect, it } from 'vitest';
import { isReloadShortcut, shouldBlockReload } from './blockReload';

const key = (partial: Partial<KeyboardEvent>): Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'> => ({
    key: 'a',
    metaKey: false,
    ctrlKey: false,
    ...partial,
});

describe('isReloadShortcut', () => {
    it('matches Cmd+R, Ctrl+R, and F5', () => {
        expect(isReloadShortcut(key({ key: 'r', metaKey: true }))).toBe(true);
        expect(isReloadShortcut(key({ key: 'R', ctrlKey: true }))).toBe(true);
        expect(isReloadShortcut(key({ key: 'F5' }))).toBe(true);
    });

    it('ignores plain R and other mod combos', () => {
        expect(isReloadShortcut(key({ key: 'r' }))).toBe(false);
        expect(isReloadShortcut(key({ key: 'r', metaKey: true, ctrlKey: false }))).toBe(true);
        expect(isReloadShortcut(key({ key: 'd', metaKey: true }))).toBe(false);
    });
});

describe('shouldBlockReload', () => {
    it('blocks only while roasting', () => {
        expect(shouldBlockReload('roasting')).toBe(true);
        expect(shouldBlockReload('idle')).toBe(false);
        expect(shouldBlockReload('preheating')).toBe(false);
        expect(shouldBlockReload('standby')).toBe(false);
        expect(shouldBlockReload('ended')).toBe(false);
    });
});
