// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
    isRoastChargeShortcutEnabled,
    isRoastEventMarkEnabled,
    isRoastMarkShortcutEnabled,
    isRoastRefreshBlocked,
    isRoastShortcutBaseEnabled,
    useRoastKeyboardShortcuts,
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

describe('desktop roast context menu', () => {
    it('blocks the native menu during roasting without swallowing chart right-clicks', () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        let chartRightClicks = 0;
        const Chart = ({ phase }: { phase: string }) => {
            useRoastKeyboardShortcuts({
                isActive: true,
                isFullscreen: false,
                showEndRoastModal: false,
                showSummaryModal: false,
                phase,
                awaitingNextCharge: false,
                onToggleFullscreen: () => {},
                onExitFullscreen: () => {},
                onEnterStandby: () => {},
                onManualCharge: () => {},
                onMarkEvent: () => {},
                onMarkDrop: () => {},
            });
            return createElement('div', { onContextMenu: () => chartRightClicks++ });
        };
        try {
            act(() => root.render(createElement(Chart, { phase: 'roasting' })));
            const blocked = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            act(() => container.firstElementChild?.dispatchEvent(blocked));
            expect(blocked.defaultPrevented).toBe(true);
            expect(chartRightClicks).toBe(1);

            act(() => root.render(createElement(Chart, { phase: 'standby' })));
            const allowed = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            act(() => container.firstElementChild?.dispatchEvent(allowed));
            expect(allowed.defaultPrevented).toBe(false);
        } finally {
            act(() => root.unmount());
            container.remove();
            delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
        }
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
