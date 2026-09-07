// @vitest-environment jsdom
import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastSidePanel } from './RoastSidePanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key.split('.').pop() ?? key }),
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
    dtrPct: null,
    devTimeStr: '—',
    rollingDtrPct: null,
    rollingDevTimeStr: '',
    fcDualMarkEnabled: false,
    logEntries: [],
    pressedButtons: new Set<string>(),
    roastLogDisplayEntries: [],
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
    liveData: null as { heater: number | null; fan: number; drum: number } | null,
};

describe('RoastSidePanel live readings (#358)', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
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

    it('hides BBP until a timer is active, then shows mm:ss', () => {
        renderPanel();
        expect(container.querySelector('[data-testid="bbp-timer"]')).toBeNull();

        renderPanel({ bbpTimer: '1:05' });
        const row = container.querySelector('[data-testid="bbp-timer"]');
        expect(row?.textContent).toContain('1:05');
    });

    it('always shows heater/fan/drum, using — when a channel has no reading', () => {
        renderPanel();
        expect(container.querySelector('[data-testid="live-heater"]')?.textContent).toBe('—');
        expect(container.querySelector('[data-testid="live-fan"]')?.textContent).toBe('—');
        expect(container.querySelector('[data-testid="live-drum"]')?.textContent).toBe('—');

        renderPanel({ liveData: { heater: 50, fan: 12, drum: 40 } });
        expect(container.querySelector('[data-testid="live-heater"]')?.textContent).toBe('50%');
        expect(container.querySelector('[data-testid="live-fan"]')?.textContent).toBe('12');
        expect(container.querySelector('[data-testid="live-drum"]')?.textContent).toBe('40');

        renderPanel({ liveData: { heater: null, fan: 0, drum: 0 } });
        expect(container.querySelector('[data-testid="live-heater"]')?.textContent).toBe('—');
        expect(container.querySelector('[data-testid="live-fan"]')?.textContent).toBe('0');
        expect(container.querySelector('[data-testid="live-drum"]')?.textContent).toBe('0');
    });
});
