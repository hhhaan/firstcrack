// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { buildRoastLogDisplayEntries } from '../lib/display-derivatives';
import { RoastSidePanelLayout } from './RoastSidePanelLayout';

const settings = vi.hoisted(() => ({ logExpanded: false }));
vi.mock('@features/active-roast/model/settings', () => ({
    useRoastSettings: () => settings,
    updateRoastSettings: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])('orders automatic marks and manual controls by event time (expanded=%s)', (expanded) => {
    settings.logExpanded = expanded;
    const entries = buildRoastLogDisplayEntries(
        [
            { id: 'gas', time: '1:00', event: 'Heater', temp: '', note: '' },
            { id: 'yellow', time: '2:00', event: 'Yellow', temp: '', note: '' },
            { id: 'air', time: '3:00', event: 'Fan', temp: '', note: '' },
            { id: 'charge', time: '0:00', event: 'Charge', temp: '', note: '' },
        ],
        true,
        false,
        '',
        null,
        '',
        'C',
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        act(() =>
            root.render(
                <RoastSidePanelLayout roastLogDisplayEntries={entries} onRemoveLogEntry={vi.fn()}>
                    {null}
                </RoastSidePanelLayout>,
            ),
        );
        const text = host.textContent ?? '';
        expect(text.indexOf('0:00')).toBeLessThan(text.indexOf('1:00'));
        expect(text.indexOf('1:00')).toBeLessThan(text.indexOf('2:00'));
        expect(text.indexOf('2:00')).toBeLessThan(text.indexOf('3:00'));
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});

it('switches the temperature panel between 176px and 240px', () => {
    settings.logExpanded = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const pointer = (divider: HTMLDivElement, type: string, x: number) =>
        act(() => {
            divider.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1, button: 0 }));
        });
    try {
        act(() =>
            root.render(
                <RoastSidePanelLayout roastLogDisplayEntries={[]} onRemoveLogEntry={vi.fn()}>
                    {null}
                </RoastSidePanelLayout>,
            ),
        );
        const panel = host.querySelector('[data-testid="roast-side-panel"]') as HTMLDivElement;
        const divider = panel.querySelector('[role="separator"]') as HTMLDivElement;
        divider.setPointerCapture = vi.fn();
        expect(divider.getAttribute('aria-valuemin')).toBe('176');
        expect(divider.getAttribute('aria-valuemax')).toBe('240');
        expect(panel.style.width).toBe('176px');
        pointer(divider, 'pointerdown', 400);
        pointer(divider, 'pointermove', 398);
        expect(panel.style.width).toBe('176px');
        pointer(divider, 'pointermove', 340);
        expect(panel.style.width).toBe('240px');
        pointer(divider, 'lostpointercapture', 340);
        pointer(divider, 'pointerdown', 300);
        pointer(divider, 'pointermove', 360);
        expect(panel.style.width).toBe('176px');
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
