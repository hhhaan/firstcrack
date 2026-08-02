import { describe, expect, it } from 'vitest';
import { isRoastMarkShortcutEnabled, isRoastShortcutBaseEnabled } from './useRoastKeyboardShortcuts';

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
