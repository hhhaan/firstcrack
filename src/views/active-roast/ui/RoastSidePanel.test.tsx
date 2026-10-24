// @vitest-environment jsdom

import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import type { LogEntry } from '@shared/types/roast';
import { act, type ComponentProps, createElement } from 'react';
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

    const renderPanel = (override: Partial<ComponentProps<typeof RoastSidePanel>> = {}) => {
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

    it('hides turned-off mark buttons and shows an enabled custom name', () => {
        act(() => {
            updateRoastSettings({
                eventButtons: {
                    yellow: false,
                    fcStart: true,
                    fcEnd: false,
                    custom: [
                        { id: 'aroma', name: 'Aroma', enabled: true },
                        { id: 'off', name: 'Hidden', enabled: false },
                    ],
                },
            });
        });
        renderPanel();
        const labels = [...container.querySelectorAll('button')].map((button) => button.textContent ?? '');
        expect(labels.some((label) => label.includes('Yellow'))).toBe(false);
        expect(labels.some((label) => label.includes('FC End'))).toBe(false);
        expect(labels.some((label) => label.includes('FC Start'))).toBe(true);
        expect(labels.some((label) => label.includes('Aroma'))).toBe(true);
        expect(labels.some((label) => label.includes('Hidden'))).toBe(false);
        expect(labels.some((label) => label.includes('Mark Drop'))).toBe(true);
        act(() => {
            updateRoastSettings({ eventButtons: { yellow: true, fcStart: true, fcEnd: true, custom: [] } });
        });
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
        expect(container.querySelector('[data-testid="return-to-charge-wait"]')).toBeNull();
        expect(container.querySelector('[data-testid="roast-time"]')).toBeNull();
        expect(container.querySelector('[data-testid="bbp-timer"]')?.textContent).toContain('1:05');
    });

    it('saved-curve review replaces Charge with return to the wait chart', () => {
        const onDismissReview = vi.fn();
        renderPanel({
            phase: 'standby',
            charged: false,
            roastEnded: false,
            bbpChargeWait: true,
            reviewing: true,
            onDismissReview,
        });
        const back = container.querySelector('[data-testid="return-to-charge-wait"]') as HTMLButtonElement;
        expect(container.querySelector('[data-testid="roast-charge"]')).toBeNull();
        expect(back.textContent).toContain('return');
        act(() => back.click());
        expect(onDismissReview).toHaveBeenCalledOnce();
    });

    it('saved-curve review adds Yellow and does not drop', () => {
        const onMarkEvent = vi.fn();
        const onAddEvent = vi.fn();
        const onHandleDrop = vi.fn();
        renderPanel({
            phase: 'standby',
            charged: false,
            roastEnded: false,
            bbpChargeWait: true,
            reviewing: true,
            onMarkEvent,
            onAddEvent,
            logEditOptions: { unit: 'C', livePoints: [], maxTimeSec: 600, onEditEntry: vi.fn() },
            onHandleDrop,
        });
        const button = (label: string) =>
            [...container.querySelectorAll('button')].find((item) =>
                (item.textContent ?? '').includes(label),
            ) as HTMLButtonElement;
        const yellow = button('Yellow');
        expect(yellow.disabled).toBe(false);
        act(() => yellow.click());
        const time = container.querySelector<HTMLInputElement>('input[name="time"]');
        expect(time).not.toBeNull();
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(time, '2:00');
            time?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() =>
            container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onAddEvent).toHaveBeenCalledWith('Yellow', 120, undefined);
        expect(onMarkEvent).not.toHaveBeenCalled();
        const drop = button('Mark Drop');
        expect(drop.disabled).toBe(true);
        act(() => drop.click());
        expect(onHandleDrop).not.toHaveBeenCalled();
    });

    it.each(['FC Rolling', 'Aroma'])('adds %s to a snapshot without calling live marking', (event) => {
        const previous = getRoastSettings().eventButtons;
        const onAddEvent = vi.fn();
        const onMarkEvent = vi.fn();
        const onCycleFc = vi.fn();
        try {
            updateRoastSettings({ eventButtons: { custom: [{ id: 'aroma', name: 'Aroma', enabled: true }] } });
            renderPanel({
                reviewing: true,
                phase: 'standby',
                fcDualMarkEnabled: true,
                fcDualUnwind: true,
                logEntries: [{ id: 'fc', event: 'FC Start', time: '1:00', timeSec: 60, temp: '', note: '' }],
                onAddEvent,
                onMarkEvent,
                onCycleFc,
                logEditOptions: { unit: 'C', livePoints: [], maxTimeSec: 600, onEditEntry: vi.fn() },
            });
            const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(event));
            expect(button?.disabled).toBe(false);
            act(() => button?.click());
            const time = container.querySelector<HTMLInputElement>('input[name="time"]');
            act(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(time, '2:00');
                time?.dispatchEvent(new Event('input', { bubbles: true }));
            });
            act(() => time?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
            expect(onAddEvent).toHaveBeenCalledWith(event, 120, undefined);
            expect(onMarkEvent).not.toHaveBeenCalled();
            expect(onCycleFc).not.toHaveBeenCalled();
        } finally {
            updateRoastSettings({ eventButtons: previous });
        }
    });

    it('saved-curve review deletes phase marks, notes, and custom marks but protects End', () => {
        renderPanel({
            reviewing: true,
            phase: 'standby',
            roastLogDisplayEntries: [
                { id: 'c', time: '0:00', event: 'Charge', temp: '', note: '' },
                { id: 'tp', time: '0:30', event: 'TP', temp: '', note: '' },
                { id: 'y', time: '1:00', event: 'Yellow', temp: '', note: '' },
                { id: 'n', time: '2:00', event: 'Note', temp: '', note: 'hi' },
                { id: 's', time: '3:00', event: '시바', temp: '', note: '' },
                { id: 'e', time: '4:00', event: 'End', temp: '', note: '' },
                { id: 'd', time: '5:00', event: 'Drop', temp: '', note: '' },
            ],
        });
        const side = container.querySelector('[data-testid="roast-side-panel"]') as HTMLElement;
        expect((side.querySelector('[aria-label="Delete tp"]') as HTMLButtonElement).disabled).toBe(true);
        expect(side.querySelector('[aria-label="Delete yellow"]')).not.toBeNull();
        expect(side.querySelector('[aria-label="Delete note"]')).not.toBeNull();
        expect(side.querySelector('[aria-label="Delete 시바"]')).not.toBeNull();
        expect(side.querySelector('[aria-label="Delete end"]')).toBeNull();
        expect(side.querySelector('[aria-label="Delete charge"]')).toBeNull();
        expect(side.querySelector('[aria-label="Delete drop"]')).toBeNull();
    });

    it('disables End Roast while reviewing a completed snapshot', () => {
        const onEndRoast = vi.fn();
        renderPanel({ reviewing: true, roastEnded: true, onEndRoast });
        const end = container.querySelector<HTMLButtonElement>('[data-testid="roast-end"]');
        expect(end?.disabled).toBe(true);
        act(() => end?.click());
        expect(onEndRoast).not.toHaveBeenCalled();
    });

    it('saved-curve review leaves an existing Yellow disabled without deleting it', () => {
        const onMarkEvent = vi.fn();
        renderPanel({
            reviewing: true,
            phase: 'standby',
            bbpChargeWait: true,
            logEntries: [{ id: 'y', time: '1:00', event: 'Yellow', temp: '', note: '' }],
            onMarkEvent,
            onAddEvent: vi.fn(),
            logEditOptions: { unit: 'C', livePoints: [], maxTimeSec: 600, onEditEntry: vi.fn() },
        });
        const yellow = [...container.querySelectorAll('button')].find((item) =>
            (item.textContent ?? '').includes('Yellow'),
        ) as HTMLButtonElement;
        expect(yellow.disabled).toBe(true);
        act(() => yellow.click());
        expect(onMarkEvent).not.toHaveBeenCalled();
    });
    it('opens a separate chronological log and ignores Escape and restores focus on collapse without losing the note draft', () => {
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
        expect((log.textContent ?? '').indexOf('0:00')).toBeLessThan((log.textContent ?? '').indexOf('aroma'));
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
