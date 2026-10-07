// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PanelResizeHandle } from './PanelResizeHandle';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('clamps drag and keyboard changes and stops resizing after capture ends', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Panel = () => {
        const [width, setWidth] = useState(200);
        return createElement(PanelResizeHandle, {
            label: 'Resize panel',
            controls: 'example',
            width,
            min: 160,
            max: 360,
            onWidthChange: setWidth,
        });
    };
    try {
        act(() => root.render(createElement(Panel)));
        const divider = host.querySelector('[role="separator"]') as HTMLDivElement;
        divider.setPointerCapture = vi.fn();
        const pointer = (type: string, x: number, button = 0) =>
            act(() => {
                divider.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1, button }));
            });
        const key = (key: string) =>
            act(() => divider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
        pointer('pointerdown', 500, 2);
        pointer('pointermove', 400);
        expect(divider.getAttribute('aria-valuenow')).toBe('200');
        pointer('pointerdown', 500);
        expect(divider.setPointerCapture).toHaveBeenCalledWith(1);
        pointer('pointermove', 440);
        expect(divider.getAttribute('aria-valuenow')).toBe('260');
        pointer('pointermove', 0);
        expect(divider.getAttribute('aria-valuenow')).toBe('360');
        pointer('lostpointercapture', 0);
        pointer('pointermove', 900);
        expect(divider.getAttribute('aria-valuenow')).toBe('360');
        key('Home');
        key('ArrowRight');
        expect(divider.getAttribute('aria-valuenow')).toBe('160');
        key('ArrowLeft');
        expect(divider.getAttribute('aria-valuenow')).toBe('170');
        key('End');
        key('ArrowLeft');
        key('Escape');
        expect(divider.getAttribute('aria-valuenow')).toBe('360');
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
