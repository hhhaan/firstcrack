/** @vitest-environment jsdom */
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShortcutCapture } from './useShortcutCapture';

const press = (key: string, shiftKey: boolean, extra: KeyboardEventInit = {}) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true, ...extra }));
};
const release = (key: string, shiftKey: boolean, extra: KeyboardEventInit = {}) => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey, bubbles: true, cancelable: true, ...extra }));
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

    it('saves a bare Enter', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press('Enter', false, { code: 'Enter' }));
        expect(draft.current).toBe('enter');
        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('enter');
    });

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

    it('saves Enter when IME reports Process', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press('Process', false, { code: 'Enter' }));
        expect(draft.current).toBe('enter');
        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('enter');
    });

    it('saves Shift+Enter when IME reports Process', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press('Process', true, { code: 'Enter' }));
        expect(draft.current).toBe('shift+enter');
        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('shift+enter');
    });

    it('saves Shift+Enter while composing', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press('Enter', true, { code: 'Enter', isComposing: true }));
        expect(draft.current).toBe('shift+enter');
        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('shift+enter');
    });

    it('saves Space', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press(' ', false, { code: 'Space' }));
        expect(draft.current).toBe('space');
        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('space');
    });

    it('saves Shift+Space when IME reports Process', () => {
        const onCommit = vi.fn();
        const draft = mount(onCommit);

        act(() => press('Process', true, { code: 'Space' }));
        expect(draft.current).toBe('shift+space');
        act(() => vi.advanceTimersByTime(400));
        expect(onCommit).toHaveBeenCalledWith('shift+space');
    });

    it('saves a Process Shift+Enter double after release', () => {
        const onCommit = vi.fn();
        mount(onCommit);

        act(() => {
            press('Process', true, { code: 'Enter' });
            release('Process', true, { code: 'Enter' });
            vi.advanceTimersByTime(80);
            press('Process', true, { code: 'Enter' });
        });

        expect(onCommit).toHaveBeenCalledWith('shift+enter shift+enter');
    });
});
