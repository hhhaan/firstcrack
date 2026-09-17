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
                unacknowledged: false,
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
        unmount();
    });
});
