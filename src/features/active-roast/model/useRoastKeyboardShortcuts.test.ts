import { describe, expect, it } from 'vitest';
import {
    isRoastChargeShortcutEnabled,
    isRoastEventMarkEnabled,
    isRoastMarkShortcutEnabled,
    isRoastShortcutBaseEnabled,
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
        expect(shortcutsSrc).toContain('enableOnFormTags: true');
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
