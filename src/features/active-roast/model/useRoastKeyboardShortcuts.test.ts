import { describe, expect, it } from 'vitest';
import {
    isRoastChargeShortcutEnabled,
    isRoastEventMarkEnabled,
    isRoastRefreshBlocked,
    isRoastReturnToChargeWaitShortcutEnabled,
    isRoastShortcutBaseEnabled,
    isRoastSummaryCloseShortcutEnabled,
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

describe('Drop hotkey while the window is focused', () => {
    it('keeps the webview hotkey armed and dedupes it with the OS shortcut', () => {
        expect(shortcutsSrc).toContain('enableOnFormTags: dropEnabledOnFormTags');
        expect(shortcutsSrc).toContain('DROP_SHORTCUT_DEDUPE_MS');
        expect(shortcutsSrc).not.toContain('dropHeldGlobally');
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

describe('isRoastSummaryCloseShortcutEnabled', () => {
    it('is enabled only while the summary popup is open', () => {
        const base = {
            isActive: true,
            showEndRoastModal: false,
            showContinueModal: false,
        };
        expect(isRoastSummaryCloseShortcutEnabled({ ...base, showSummaryModal: true })).toBe(true);
        expect(isRoastSummaryCloseShortcutEnabled({ ...base, showSummaryModal: false })).toBe(false);
        expect(isRoastSummaryCloseShortcutEnabled({ ...base, showSummaryModal: true, showEndRoastModal: true })).toBe(
            false,
        );
    });

    it('stays off while the summary save path is busy', () => {
        expect(
            isRoastSummaryCloseShortcutEnabled({
                isActive: true,
                showSummaryModal: true,
                showEndRoastModal: false,
                roastSummarySaving: true,
            }),
        ).toBe(false);
    });
});

describe('isRoastReturnToChargeWaitShortcutEnabled', () => {
    it('fires only during saved-curve review without blocking modals or charge lock', () => {
        const base = {
            isActive: true,
            showEndRoastModal: false,
            showSummaryModal: false,
            showContinueModal: false,
            chargeLocked: false,
        };
        expect(isRoastReturnToChargeWaitShortcutEnabled({ ...base, reviewing: true })).toBe(true);
        expect(isRoastReturnToChargeWaitShortcutEnabled({ ...base, reviewing: false })).toBe(false);
        expect(isRoastReturnToChargeWaitShortcutEnabled({ ...base, reviewing: true, showSummaryModal: true })).toBe(
            false,
        );
        expect(isRoastReturnToChargeWaitShortcutEnabled({ ...base, reviewing: true, chargeLocked: true })).toBe(false);
    });
});
