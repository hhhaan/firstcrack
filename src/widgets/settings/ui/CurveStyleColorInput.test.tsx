// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurveStyleColorInput, shouldCommitCurveColor } from './CurveStyleColorInput';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('shouldCommitCurveColor', () => {
    it('does not treat theme fallback display as a stored custom color', () => {
        expect(shouldCommitCurveColor('#aabbcc', null)).toBe(true);
        expect(shouldCommitCurveColor('#aabbcc', '#aabbcc')).toBe(false);
    });
});

describe('CurveStyleColorInput', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onCommit = vi.fn<(color: string) => void>();

    const render = (value: string | null) => {
        act(() => {
            root.render(
                createElement(CurveStyleColorInput, {
                    value,
                    themeFallback: '#112233',
                    label: 'BT Color',
                    onCommit,
                }),
            );
        });
        return container.querySelector('input[type="color"]') as HTMLInputElement;
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        onCommit.mockClear();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('focus and blur without change does not commit when color is null', () => {
        const input = render(null);
        act(() => {
            input.focus();
            input.blur();
        });
        expect(onCommit).not.toHaveBeenCalled();
    });

    const pickColor = (input: HTMLInputElement, hex: string) => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => {
            setValue?.call(input, hex);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    };

    it('commits a pending change on blur', () => {
        const input = render(null);
        act(() => input.focus());
        pickColor(input, '#e53935');
        act(() => input.blur());
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('#e53935');
    });

    it('commits a pending change on unmount', () => {
        const input = render(null);
        pickColor(input, '#e53935');
        act(() => root.unmount());
        expect(onCommit).toHaveBeenCalledWith('#e53935');
    });
});
