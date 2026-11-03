/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoundShortcut } from './useDoubleShortcut';

const down = (shiftKey: boolean) => {
    document.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            shiftKey,
            bubbles: true,
            cancelable: true,
        }),
    );
};
const up = (shiftKey: boolean) => {
    window.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', shiftKey, bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', shiftKey, bubbles: true, cancelable: true }),
    );
};

describe('useBoundShortcut', () => {
    let root: Root;
    const host = document.createElement('div');

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.useRealTimers();
    });

    it('fires the single after the wait and the double on the second press', () => {
        const single = vi.fn();
        const doubled = vi.fn();
        const View = () => {
            useBoundShortcut(['shift+enter'], single);
            useBoundShortcut(['shift+enter shift+enter'], doubled);
            return null;
        };
        act(() => root.render(createElement(View)));

        act(() => {
            down(true);
            up(true);
        });
        expect(single).not.toHaveBeenCalled();
        expect(doubled).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(400));
        expect(single).toHaveBeenCalledTimes(1);
        expect(doubled).not.toHaveBeenCalled();

        act(() => {
            down(true);
            up(true);
            vi.advanceTimersByTime(80);
            down(true);
        });
        expect(doubled).toHaveBeenCalledTimes(1);
        expect(single).toHaveBeenCalledTimes(1);
    });
});
