import { describe, expect, it } from 'vitest';
import {
    CUSTOM_EVENT_LIMIT,
    CUSTOM_EVENT_SHORTCUTS,
    effectiveCustomShortcuts,
    eventNameError,
    isCustomRoastEvent,
    nextCustomEventShortcut,
    normalizeEventButtons,
} from './event-buttons';

describe('normalizeEventButtons', () => {
    it('turns the three built-in buttons on when the field is missing', () => {
        expect(normalizeEventButtons(undefined)).toEqual({
            yellow: true,
            fcStart: true,
            fcEnd: true,
            custom: [],
        });
    });

    it('keeps an explicit off and drops reserved, blank, and duplicate names', () => {
        expect(
            normalizeEventButtons({
                yellow: false,
                fcStart: true,
                fcEnd: false,
                custom: [
                    { id: 'a', name: '  아로마 ', enabled: true },
                    { id: 'b', name: 'Yellow', enabled: true },
                    { id: 'c', name: '   ', enabled: true },
                    { id: 'a', name: '다른이름', enabled: true },
                    { id: 'd', name: '아로마', enabled: false },
                    { id: 'e', name: '배출', enabled: true },
                ],
            }),
        ).toEqual({
            yellow: false,
            fcStart: true,
            fcEnd: false,
            custom: [{ id: 'a', name: '아로마', enabled: true }],
        });
    });

    it('keeps one explicit shortcut and drops reserved or duplicate keys', () => {
        expect(
            normalizeEventButtons({
                custom: [
                    { id: 'a', name: '아로마', enabled: true, shortcut: 'Mod+4' },
                    { id: 'b', name: '시바', enabled: true, shortcut: 'escape' },
                    { id: 'c', name: '향', enabled: true, shortcut: 'mod+4' },
                ],
            }).custom,
        ).toEqual([
            { id: 'a', name: '아로마', enabled: true, shortcut: 'mod+4' },
            { id: 'b', name: '시바', enabled: true },
            { id: 'c', name: '향', enabled: true },
        ]);
    });

    it('stops at eight custom names', () => {
        const custom = Array.from({ length: 10 }, (_, index) => ({
            id: `id-${index}`,
            name: `이름${index}`,
            enabled: true,
        }));
        expect(normalizeEventButtons({ custom }).custom).toHaveLength(CUSTOM_EVENT_LIMIT);
    });
});

describe('eventNameError', () => {
    it('rejects an empty, reserved, or duplicate name', () => {
        expect(eventNameError('  ', [], false)).toBe('invalid');
        expect(eventNameError('fc start', [], false)).toBe('invalid');
        expect(eventNameError('컬러 체인지', [], false)).toBe('invalid');
        expect(eventNameError('아로마', ['아로마'], false)).toBe('invalid');
    });

    it('rejects the ninth name', () => {
        expect(eventNameError('아로마', [], true)).toBe('limit');
    });

    it('accepts a new name', () => {
        expect(eventNameError(' 아로마 ', [], false)).toBeNull();
    });
});

describe('effectiveCustomShortcuts', () => {
    it('fills empty rows from mod+4 and leaves the eighth without a digit', () => {
        const rows = Array.from({ length: 8 }, () => ({}));
        expect(effectiveCustomShortcuts(rows, [])).toEqual([...CUSTOM_EVENT_SHORTCUTS, undefined]);
    });

    it('skips a digit another action already uses', () => {
        expect(effectiveCustomShortcuts([{}], ['mod+4'])).toEqual(['mod+5']);
        expect(nextCustomEventShortcut(['mod+4', 'mod+5'])).toBe('mod+6');
    });

    it('keeps an explicit key and does not move it onto a free digit when that key is taken', () => {
        expect(effectiveCustomShortcuts([{ shortcut: 'mod+a' }, {}], [])).toEqual(['mod+a', 'mod+4']);
        expect(effectiveCustomShortcuts([{}, { shortcut: 'mod+4' }], [])).toEqual(['mod+5', 'mod+4']);
        expect(effectiveCustomShortcuts([{ shortcut: 'mod+4' }], ['mod+4'])).toEqual([undefined]);
    });
});

describe('isCustomRoastEvent', () => {
    it('treats an unknown name as a user mark and leaves built-in types alone', () => {
        expect(isCustomRoastEvent('아로마')).toBe(true);
        expect(isCustomRoastEvent('FC End')).toBe(false);
        expect(isCustomRoastEvent('TP')).toBe(false);
        expect(isCustomRoastEvent('Now')).toBe(false);
        expect(isCustomRoastEvent('Control')).toBe(false);
    });
});
