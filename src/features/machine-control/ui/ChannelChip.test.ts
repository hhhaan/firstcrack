// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelChip } from './ChannelChip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderChip = (overrides: Partial<Parameters<typeof ChannelChip>[0]> = {}) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
        root.render(
            createElement(ChannelChip, {
                role: 'fan',
                limit: { min: 0, max: 100, unit: '%' },
                value: 80,
                feedback: 80,
                disabled: false,
                onChange,
                onCommit,
                ...overrides,
            }),
        ),
    );
    return {
        container,
        onChange,
        onCommit,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('ChannelChip (#436)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('+는 5% 스냅 후 즉시 커밋한다', () => {
        const { container, onChange, onCommit, unmount } = renderChip({ value: 80, feedback: 80 });
        act(() => (container.querySelector('[data-step="5"]') as HTMLButtonElement).click());
        expect(onChange).toHaveBeenCalledWith('fan', 85);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it.each([
        [40, 'plus', 41],
        [49, 'plus', 50],
        [55, 'plus', 55],
        [55, 'minus', 54],
        [40, 'minus', 40],
    ] as const)('drum %i Hz %s stays within 40–55 Hz in one-Hz steps', (current, direction, expected) => {
        const { container, onChange, onCommit, unmount } = renderChip({
            role: 'drum',
            limit: { min: 40, max: 55, unit: 'Hz' },
            value: current,
            feedback: current,
        });
        expect(container.textContent).toContain('Hz');
        act(() => (container.querySelector(`[aria-label="Drum ${direction}"]`) as HTMLButtonElement).click());
        if (expected === current) {
            expect(onChange).not.toHaveBeenCalled();
            expect(onCommit).not.toHaveBeenCalled();
        } else {
            expect(onChange).toHaveBeenCalledExactlyOnceWith('drum', expected);
            expect(onCommit).toHaveBeenCalledTimes(1);
        }
        unmount();
    });

    it.each([
        ['1', 40],
        ['99', 55],
    ])('clamps typed drum value %s to %i Hz on Enter', (typed, expected) => {
        const { container, onChange, onCommit, unmount } = renderChip({
            role: 'drum',
            limit: { min: 40, max: 55, unit: 'Hz' },
            value: 45,
            feedback: 45,
        });
        const input = container.querySelector('[data-channel-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => {
            setValue?.call(input, typed);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(onChange).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('drum', expected);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it.each(['fan', 'drum'] as const)('%s commits once per full pointer click and ignores right-clicks', (role) => {
        const { container, onChange, onCommit, unmount } = renderChip({ role });
        const plus = container.querySelector('[data-step="5"]') as HTMLButtonElement;
        act(() => {
            plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
            plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 2 }));
        });
        expect(onCommit).not.toHaveBeenCalled();
        act(() => {
            plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            plus.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        });
        expect(onChange).toHaveBeenCalledExactlyOnceWith(role, 85);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('disabled면 나가지 않는다', () => {
        const { container, onChange, onCommit, unmount } = renderChip({ disabled: true });
        act(() => (container.querySelector('[data-step="5"]') as HTMLButtonElement).click());
        expect(onChange).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
        unmount();
    });

    it('미지원이면 대시를 보여 준다', () => {
        const { container, unmount } = renderChip({ unsupported: true, value: undefined, feedback: null });
        expect(container.textContent).toContain('—');
        expect(container.querySelector('[data-channel-input]')).toBeNull();
        unmount();
    });

    it('숫자 입력은 Enter에서만 보낸다', () => {
        const { container, onChange, onCommit, unmount } = renderChip({ value: 20, feedback: 20 });
        const input = container.querySelector('[data-channel-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '35');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(onChange).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('fan', 35);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('포커스를 벗어나거나 Escape면 전송 없이 취소한다', () => {
        const { container, onChange, onCommit, unmount } = renderChip({ role: 'drum', value: 50, feedback: 50 });
        const input = container.querySelector('[data-channel-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '12');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => input.blur());
        expect(input.value).toBe('50');
        expect(onChange).not.toHaveBeenCalled();
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '12');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(onCommit).not.toHaveBeenCalled();
        expect(input.value).toBe('50');
        unmount();
    });

    it('화살표는 1단위로 고치고 Enter 전에 보내지 않는다', () => {
        const { container, onChange, unmount } = renderChip({ value: 20, feedback: 20 });
        const input = container.querySelector('[data-channel-input]') as HTMLInputElement;
        act(() => input.focus());
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
        expect(input.value).toBe('21');
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        expect(input.value).toBe('20');
        expect(onChange).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('fan', 20);
        unmount();
    });

    it('글자를 버리고 min/max로 자른다', () => {
        const { container, onChange, unmount } = renderChip({ value: 20, feedback: 20 });
        const input = container.querySelector('[data-channel-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => {
            setValue?.call(input, '12a9');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('129');
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('fan', 100);
        unmount();
    });
});
