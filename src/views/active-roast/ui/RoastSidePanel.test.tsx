// @vitest-environment jsdom

import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { updateRoastSettings } from '@features/active-roast/model/settings';
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastSidePanel } from './RoastSidePanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key.split('.').pop() ?? key }),
}));

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

const noop = () => undefined;

const baseProps = {
    rawBT: 200,
    rawET: 180,
    displayRoR: '12.0',
    timeStr: '8:00',
    unit: 'C' as const,
    phase: 'roasting',
    roastPhaseName: 'Maillard',
    roastPhaseColor: '#000',
    charged: true,
    roastEnded: false,
    deltaBT: '1.0',
    deltaET: '0.5',
    targetDelta: null,
    activeAlerts: [] as RoastAlertKind[],
    dtrPct: null as number | null,
    devTimeStr: '—',
    rollingDtrPct: null,
    rollingDevTimeStr: '',
    fcDualMarkEnabled: false,
    logEntries: [],
    pressedButtons: new Set<string>(),
    roastLogDisplayEntries: [] as LogEntry[],
    noteInput: '',
    onNoteChange: noop,
    onNoteSubmit: noop,
    onMarkEvent: noop,
    onCycleFc: noop,
    onHandleDrop: noop,
    onRemoveLogEntry: noop,
    onEnterStandby: noop,
    onManualCharge: noop,
    onEndRoast: noop,
    bbpTimer: null as string | null,
    bbpChargeWait: false,
};

describe('RoastSidePanel live readings (#358)', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        updateRoastSettings({ logExpanded: false });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        void act(() => root.unmount());
        container.remove();
    });

    const renderPanel = (override: Partial<typeof baseProps> = {}) => {
        void act(() => root.render(createElement(RoastSidePanel, { ...baseProps, ...override })));
    };

    it('hides DTR and Dev until they are calculated', () => {
        renderPanel();
        expect(container.querySelector('[data-testid="dtr-row"]')).toBeNull();
        expect(container.querySelector('[data-testid="dev-row"]')).toBeNull();

        renderPanel({ dtrPct: 20.5, devTimeStr: '2:00' });
        expect(container.querySelector('[data-testid="dtr-row"]')?.textContent).toContain('20.5%');
        expect(container.querySelector('[data-testid="dev-row"]')?.textContent).toContain('2:00');
    });

    it('hides BBP until a timer is active, then shows mm:ss', () => {
        renderPanel();
        expect(container.querySelector('[data-testid="bbp-timer"]')).toBeNull();

        renderPanel({ bbpTimer: '1:05' });
        const row = container.querySelector('[data-testid="bbp-timer"]');
        expect(row?.textContent).toContain('1:05');
    });

    it('BBP wait shows Charge, not Roast Ready', () => {
        renderPanel({
            phase: 'preheating',
            charged: false,
            roastEnded: false,
            bbpTimer: '2:10',
            bbpChargeWait: true,
        });
        expect(container.querySelector('[data-testid="roast-ready"]')).toBeNull();
        expect(container.querySelector('[data-testid="roast-charge"]')).not.toBeNull();
    });

    it('첫 배치 예열은 Roast Ready를 유지한다', () => {
        renderPanel({
            phase: 'preheating',
            charged: false,
            roastEnded: false,
            bbpTimer: null,
            bbpChargeWait: false,
        });
        expect(container.querySelector('[data-testid="roast-ready"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="roast-charge"]')).toBeNull();
    });

    it('#484 Drop 이후 Charge wait: Charge 표시, Time 숨김, End Roast는 abort 전용으로 비활성', () => {
        renderPanel({
            phase: 'standby',
            charged: false,
            roastEnded: false,
            roastPhaseName: 'READY',
            bbpTimer: '1:05',
            bbpChargeWait: true,
            timeStr: '8:42',
        });
        const end = container.querySelector('[data-testid="roast-end"]');
        expect(end).not.toBeNull();
        expect((end as HTMLButtonElement).disabled).toBe(true);
        expect(container.querySelector('[data-testid="roast-charge"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="roast-time"]')).toBeNull();
        expect(container.querySelector('[data-testid="bbp-timer"]')?.textContent).toContain('1:05');
    });
    it('opens a separate newest-first log and ignores Escape and restores focus on collapse without losing the note draft', () => {
        const onRemoveLogEntry = vi.fn();
        const entries: LogEntry[] = [
            { id: 'charge', time: '0:00', event: 'Charge', temp: '180°C', note: '' },
            { id: 'note', time: '1:00', event: 'Note', temp: '190°C', note: 'aroma' },
        ];
        renderPanel({ roastLogDisplayEntries: entries, noteInput: 'draft', onRemoveLogEntry });
        const sidePanel = container.querySelector('[data-testid="roast-side-panel"]') as HTMLDivElement;
        const trigger = sidePanel.querySelector('[aria-expanded]') as HTMLButtonElement;
        const noteInput = sidePanel.querySelector('textarea');
        expect(noteInput?.compareDocumentPosition(trigger)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(sidePanel.textContent).toContain('aroma');
        act(() => trigger.click());
        const log = container.querySelector('[data-testid="roast-log-panel"]') as HTMLElement;
        expect(log.parentElement).toBe(sidePanel.parentElement);
        expect(sidePanel.textContent).not.toContain('aroma');
        expect(trigger.getAttribute('aria-controls')).toBe(log.id);
        expect(sidePanel.querySelector('[aria-expanded]')).toBeNull();
        expect(sidePanel.textContent).not.toContain('title');
        expect((log.textContent ?? '').indexOf('aroma')).toBeLessThan((log.textContent ?? '').indexOf('0:00'));
        expect(document.activeElement).toBe(log.querySelector('button'));
        expect(sidePanel.querySelector('textarea')).toBe(noteInput);
        expect(noteInput?.value).toBe('draft');
        act(() => (log.querySelector('[aria-label="Delete note"]') as HTMLButtonElement).click());
        expect(onRemoveLogEntry).toHaveBeenCalledWith('note');
        act(() => log.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(container.querySelector('[data-testid="roast-log-panel"]')).toBe(log);
        act(() => (log.querySelector('button') as HTMLButtonElement).click());
        expect(container.querySelector('[data-testid="roast-log-panel"]')).toBeNull();
        const restoredTrigger = sidePanel.querySelector('[aria-expanded]') as HTMLButtonElement;
        expect(document.activeElement).toBe(restoredTrigger);
        expect(restoredTrigger.getAttribute('aria-expanded')).toBe('false');
        expect(sidePanel.textContent).toContain('aroma');
        expect(noteInput?.value).toBe('draft');
        act(() => restoredTrigger.click());
        act(() => (container.querySelector('[data-testid="roast-log-panel"] button') as HTMLButtonElement).click());
        expect(document.activeElement).toBe(sidePanel.querySelector('[aria-expanded]'));
        expect(container.querySelector('[data-testid="roast-log-panel"]')).toBeNull();
    });
    it('keeps expanded and collapsed log choices across remounts', () => {
        renderPanel();
        act(() => (container.querySelector('[aria-expanded]') as HTMLButtonElement).click());
        act(() => root.render(null));
        renderPanel();
        expect(container.querySelector('[data-testid="roast-log-panel"]')).not.toBeNull();
        act(() => (container.querySelector('[data-testid="roast-log-panel"] button') as HTMLButtonElement).click());
        act(() => root.render(null));
        renderPanel();
        expect(container.querySelector('[data-testid="roast-log-panel"]')).toBeNull();
        expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    });
});
