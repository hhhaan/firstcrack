import { describe, expect, it } from 'vitest';
import {
    DROP_DOUBLE_TAP_MS,
    isRoastChargeShortcutEnabled,
    isRoastEventMarkEnabled,
    isRoastMarkShortcutEnabled,
    isRoastRefreshBlocked,
    isRoastShortcutBaseEnabled,
    nextDropDoubleTap,
} from './useRoastKeyboardShortcuts';
import shortcutsSrc from './useRoastKeyboardShortcuts.ts?raw';

const base = {
    isActive: true,
    showEndRoastModal: false,
    showSummaryModal: false,
    showContinueModal: false,
};

describe('isRoastShortcutBaseEnabled', () => {
    it('enabled when active and no modals', () => {
        expect(isRoastShortcutBaseEnabled(base)).toBe(true);
    });

    it('disabled when inactive or any blocking modal', () => {
        expect(isRoastShortcutBaseEnabled({ ...base, isActive: false })).toBe(false);
        expect(isRoastShortcutBaseEnabled({ ...base, showEndRoastModal: true })).toBe(false);
        expect(isRoastShortcutBaseEnabled({ ...base, showSummaryModal: true })).toBe(false);
        expect(isRoastShortcutBaseEnabled({ ...base, showContinueModal: true })).toBe(false);
    });
});

describe('isRoastChargeShortcutEnabled', () => {
    it('allows Charge while the result summary is open', () => {
        // showSummaryModal is intentionally not a gate — result entry must not block Charge.
        expect(
            isRoastChargeShortcutEnabled({
                isActive: true,
                showEndRoastModal: false,
                showContinueModal: false,
                phase: 'standby',
            }),
        ).toBe(true);
        expect(
            isRoastChargeShortcutEnabled({
                isActive: true,
                showEndRoastModal: false,
                showContinueModal: false,
                phase: 'preheating',
            }),
        ).toBe(true);
        expect(
            isRoastChargeShortcutEnabled({
                isActive: true,
                showEndRoastModal: true,
                showContinueModal: false,
                phase: 'standby',
            }),
        ).toBe(false);
    });
});

describe('Charge hotkey form tags', () => {
    it('enables mod+enter on form fields while the summary is open', () => {
        expect(shortcutsSrc).toContain('enableOnFormTags: chargeEnabledOnFormTags');
    });
});

describe('isRoastRefreshBlocked', () => {
    it('blocks an in-progress roast, an unsaved end, and the gap before the next charge', () => {
        expect(isRoastRefreshBlocked('roasting', false)).toBe(true);
        expect(isRoastRefreshBlocked('ended', false)).toBe(true);
        expect(isRoastRefreshBlocked('idle', true)).toBe(true);
    });

    it('leaves idle, preheating, and standby refreshable', () => {
        expect(isRoastRefreshBlocked('idle', false)).toBe(false);
        expect(isRoastRefreshBlocked('preheating', false)).toBe(false);
        expect(isRoastRefreshBlocked('standby', false)).toBe(false);
    });
});

describe('isRoastEventMarkEnabled', () => {
    it('true only while roasting', () => {
        expect(isRoastEventMarkEnabled('roasting')).toBe(true);
        expect(isRoastEventMarkEnabled('preheating')).toBe(false);
        expect(isRoastEventMarkEnabled('standby')).toBe(false);
        expect(isRoastEventMarkEnabled('ended')).toBe(false);
    });
});

describe('nextDropDoubleTap', () => {
    it('arms on the first tap and fires only on a second tap inside the window', () => {
        const first = nextDropDoubleTap(null, 1_000, false);
        expect(first).toEqual({ armedAt: 1_000, fire: false });
        expect(nextDropDoubleTap(first.armedAt, 1_000 + DROP_DOUBLE_TAP_MS, false)).toEqual({
            armedAt: null,
            fire: true,
        });
    });

    it('re-arms when the second tap is late, and ignores key repeat', () => {
        expect(nextDropDoubleTap(1_000, 1_000 + DROP_DOUBLE_TAP_MS + 1, false)).toEqual({
            armedAt: 1_401,
            fire: false,
        });
        expect(nextDropDoubleTap(1_000, 1_100, true)).toEqual({ armedAt: 1_000, fire: false });
    });
});

describe('isRoastMarkShortcutEnabled', () => {
    it('enabled only while phase is roasting', () => {
        expect(isRoastMarkShortcutEnabled({ ...base, phase: 'roasting' })).toBe(true);
        expect(isRoastMarkShortcutEnabled({ ...base, phase: 'standby' })).toBe(false);
        expect(isRoastMarkShortcutEnabled({ ...base, phase: 'preheating' })).toBe(false);
        expect(isRoastMarkShortcutEnabled({ ...base, phase: 'idle' })).toBe(false);
    });

    it('modals still disable mark shortcuts during roasting', () => {
        expect(
            isRoastMarkShortcutEnabled({
                ...base,
                phase: 'roasting',
                showEndRoastModal: true,
            }),
        ).toBe(false);
        expect(
            isRoastMarkShortcutEnabled({
                ...base,
                phase: 'roasting',
                showContinueModal: true,
            }),
        ).toBe(false);
    });
});
