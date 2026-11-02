/** @vitest-environment jsdom */
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShortcutCapture } from './useShortcutCapture';

const press = (key: string, shiftKey: boolean) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
};
const release = (key: string, shiftKey: boolean) => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey, bubbles: true, cancelable: true }));
};

describe('useShortcutCapture', () => {
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

    const mount = (onCommit: (shortcut: string) => void) => {
        const draft = createRef<string | null>();
        const View = () => {
            draft.current = useShortcutCapture({
                active: true,
                onCandidate: () => 'accept',
                onCommit,
                onCancel: () => undefined,
            });
            return null;
        };
        act(() => root.render(createElement(View)));
        return draft;
    };

    it('saves one press when the wait ends', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press('Enter', true));
        expect(draft.current).toBe('shift+enter');
        expect(onCommit).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('shift+enter');
    });

    it('saves a double when the same chord returns after release', () => {
        const onCommit = vi.fn();
        mount(onCommit);

        act(() => {
            press('Enter', true);
            release('Enter', true);
            vi.advanceTimersByTime(80);
            press('Enter', true);
        });

        expect(onCommit).toHaveBeenCalledWith('shift+enter shift+enter');
    });
});
