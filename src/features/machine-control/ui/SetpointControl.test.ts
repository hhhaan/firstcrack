// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlSender } from '../lib/controlSender';
import { SetpointControl } from './SetpointControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setRangeValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
};

const renderControl = (overrides: Partial<Parameters<typeof SetpointControl>[0]> = {}) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
        root.render(
            createElement(SetpointControl, {
                role: 'heater',
                limit: { min: 0, max: 100 },
                value: 10,
                feedback: 10,
                disabled: false,
                onChange,
                onCommit,
                ...overrides,
            }),
        ),
    );
    const input = container.querySelector('input') as HTMLInputElement;
    return {
        input,
        onChange,
        onCommit,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('SetpointControl interaction-end (#269)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        ['pointercancel', 'pointercancel'],
        ['blur', 'focusout'],
        ['lostpointercapture', 'lostpointercapture'],
        ['pointerup', 'pointerup'],
        ['keyup', 'keyup'],
    ] as const)('%s 에서 마지막 값을 커밋한다', (_label, event) => {
        const { input, onChange, onCommit, unmount } = renderControl();
        act(() => setRangeValue(input, '40'));
        expect(onChange).toHaveBeenCalledWith('heater', 40);

        act(() => {
            input.dispatchEvent(new Event(event, { bubbles: true }));
        });
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('pointercancel 후 blur/pointerup이 겹쳐도 전송은 한 번이다', async () => {
        const send = vi.fn(async (cmd: { heater?: number }) => cmd);
        const sender = createControlSender({ send });
        const { input, unmount } = renderControl({
            onChange: (role, value) => sender.queue(role, value),
            onCommit: () => void sender.commitNow(),
        });

        await act(async () => {
            setRangeValue(input, '40');
            input.dispatchEvent(new Event('pointercancel', { bubbles: true }));
            input.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
            input.dispatchEvent(new Event('pointerup', { bubbles: true }));
            input.dispatchEvent(new Event('focusout', { bubbles: true }));
        });

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ heater: 40 });
        unmount();
    });

    it('커밋 없이 값만 바꾸면 전송하지 않는다', async () => {
        const send = vi.fn(async (cmd: { heater?: number }) => cmd);
        const sender = createControlSender({ send });
        const { input, unmount } = renderControl({
            onChange: (role, value) => sender.queue(role, value),
            onCommit: () => void sender.commitNow(),
        });

        act(() => setRangeValue(input, '40'));
        expect(send).not.toHaveBeenCalled();
        unmount();
    });
});
