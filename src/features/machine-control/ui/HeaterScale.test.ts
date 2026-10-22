// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ControlRole, createControlSender } from '../lib/controlSender';
import { HOLD_DELAY_MS, HOLD_INTERVAL_MS } from '../lib/useHoldRepeat';
import { HeaterScale } from './HeaterScale';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderScale = (overrides: Partial<Parameters<typeof HeaterScale>[0]> = {}) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = {
        limit: { min: 0, max: 100, unit: '%' },
        value: 70 as number | undefined,
        feedback: 70 as number | null,
        disabled: false,
        onChange,
        onCommit,
        ...overrides,
    };
    const render = (next = props) => act(() => root.render(createElement(HeaterScale, next)));
    render();
    return {
        container,
        onChange,
        onCommit,
        props,
        render,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('HeaterScale A′ (#436)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('눈금 탭은 스냅한 값으로 setValue+commitNow 한다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ value: 70, feedback: 70 });
        const tick = container.querySelector('[data-tick="85"]') as HTMLButtonElement;
        act(() => tick.click());
        expect(onChange).toHaveBeenCalledWith('heater', 85);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('눈금 탭은 sender로 그 스냅 값만 보낸다', async () => {
        const send = vi.fn(async (cmd: { heater?: number }) => cmd);
        const sender = createControlSender({ send });
        const { container, unmount } = renderScale({
            value: 70,
            feedback: 70,
            onChange: (role, value) => sender.queue(role, value),
            onCommit: () => void sender.commitNow(),
        });
        await act(async () => {
            (container.querySelector('[data-tick="90"]') as HTMLButtonElement).click();
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ heater: 90 }, undefined, 'manual', undefined);
        unmount();
    });

    it('±5는 5%로 스냅한 뒤 즉시 커밋한다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ value: 73, feedback: 73 });
        act(() => (container.querySelector('[data-step="5"]') as HTMLButtonElement).click());
        expect(onChange).toHaveBeenCalledWith('heater', 80);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('슬라이더 키보드 위/아래는 1단위로 커밋한다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ value: 70, feedback: 70 });
        const slider = container.querySelector('input[type="range"]') as HTMLElement;
        act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        });
        expect(onChange).toHaveBeenCalledWith('heater', 71);
        expect(onCommit).toHaveBeenCalledTimes(1);
        act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        });
        expect(onChange).toHaveBeenLastCalledWith('heater', 72);
        act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        expect(onChange).toHaveBeenLastCalledWith('heater', 71);
        unmount();
    });

    it('지시 중이면 큰 숫자는 desired, 라이브 라인과 기기 n은 feedback', () => {
        const { container, unmount } = renderScale({ value: 80, feedback: 60 });
        expect((container.querySelector('[data-heater-input]') as HTMLInputElement).value).toBe('80');
        expect(container.textContent).toContain('기기 60');
        expect(container.querySelector('[data-live-line]')).not.toBeNull();
        unmount();
    });

    it('수렴하면 라이브 라인과 기기 n을 숨긴다', () => {
        const { container, unmount } = renderScale({ value: undefined, feedback: 80 });
        expect((container.querySelector('[data-heater-input]') as HTMLInputElement).value).toBe('80');
        expect(container.textContent).not.toMatch(/기기/);
        expect(container.querySelector('[data-live-line]')).toBeNull();
        unmount();
    });

    it('desired가 남아도 |Δ|≤1이면 라이브 라인과 기기 n을 숨긴다', () => {
        const { container, unmount } = renderScale({ value: 80, feedback: 79 });
        expect(container.textContent).not.toMatch(/기기/);
        expect(container.querySelector('[data-live-line]')).toBeNull();
        unmount();
    });

    it('따라오는 중이면 라이브 라인은 muted이다', () => {
        const { container, unmount } = renderScale({ value: 80, feedback: 60 });
        expect(container.querySelector('[data-live-line]')?.className).toMatch(/muted/);
        expect(container.querySelector('[data-live-line]')?.className).not.toMatch(/red-500/);
        unmount();
    });

    it('sending이면 칼럼 opacity-40이고 sending… 문구는 없다', () => {
        const { container, unmount } = renderScale({ sending: true });
        expect(container.textContent).not.toMatch(/sending/);
        expect(container.firstElementChild?.className).toMatch(/opacity-40/);
        unmount();
    });

    it('sending이어도 탭은 커밋한다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({
            sending: true,
            value: 70,
            feedback: 70,
        });
        act(() => (container.querySelector('[data-tick="85"]') as HTMLButtonElement).click());
        expect(onChange).toHaveBeenCalledWith('heater', 85);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('pointerup 뒤 키보드 click은 다시 커밋한다', () => {
        const { container, onChange, unmount } = renderScale({ value: 70, feedback: 70 });
        const plus = container.querySelector('[data-step="5"]') as HTMLButtonElement;
        act(() => plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        act(() => plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
        onChange.mockClear();
        act(() => plus.click());
        expect(onChange).toHaveBeenCalledWith('heater', 75);
        unmount();
    });

    it('a complete pointer click commits once even after the parent updates', () => {
        const scale = renderScale();
        const plus = scale.container.querySelector('[data-step="5"]') as HTMLButtonElement;
        act(() => plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
        scale.render({ ...scale.props, value: 75 });
        act(() => {
            plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            plus.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        });
        expect(scale.onChange).toHaveBeenCalledExactlyOnceWith('heater', 75);
        expect(scale.onCommit).toHaveBeenCalledTimes(1);
        // Native keyboard and assistive activation must still work after pointer input.
        act(() => plus.click());
        expect(scale.onChange).toHaveBeenLastCalledWith('heater', 80);
        expect(scale.onCommit).toHaveBeenCalledTimes(2);
        scale.unmount();
    });

    it.each(['pointerup', 'pointerout', 'pointercancel'])(
        '%s stops repetition without swallowing keyboard activation',
        (event) => {
            vi.useFakeTimers();
            const scale = renderScale();
            const plus = scale.container.querySelector('[data-step="5"]') as HTMLButtonElement;
            act(() => plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
            act(() => {
                vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS);
                plus.dispatchEvent(new PointerEvent(event, { bubbles: true }));
            });
            const commits = scale.onCommit.mock.calls.length;
            act(() => vi.advanceTimersByTime(1000));
            expect(scale.onCommit).toHaveBeenCalledTimes(commits);
            act(() => plus.click());
            expect(scale.onCommit).toHaveBeenCalledTimes(commits + 1);
            scale.unmount();
            vi.useRealTimers();
        },
    );

    it('disabling during a hold clears its timers', () => {
        vi.useFakeTimers();
        const scale = renderScale();
        const plus = scale.container.querySelector('[data-step="5"]') as HTMLButtonElement;
        act(() => plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        scale.render({ ...scale.props, disabled: true });
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(1000));
        expect(scale.onCommit).toHaveBeenCalledTimes(1);
        scale.unmount();
        vi.useRealTimers();
    });

    it.each([undefined, 80])('keyboard uses updated feedback/desired (desired=%s)', (value) => {
        const scale = renderScale({ value: undefined });
        scale.render({ ...scale.props, value, feedback: 80 });
        const slider = scale.container.querySelector('input[type="range"]') as HTMLElement;
        act(() => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        expect(scale.onChange).toHaveBeenCalledExactlyOnceWith('heater', 79);
        scale.unmount();
    });

    it('disabled면 탭·±5가 나가지 않는다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ disabled: true, lockedNote: 'PID' });
        act(() => (container.querySelector('[data-tick="50"]') as HTMLButtonElement).click());
        act(() => (container.querySelector('[data-step="5"]') as HTMLButtonElement).click());
        expect(onChange).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
        expect(container.textContent).toContain('PID');
        unmount();
    });

    it('모든 5% 숫자는 독립 버튼이고 10단위는 왼쪽, 나머지는 오른쪽이다', () => {
        const scale = renderScale();
        const ticks = scale.container.querySelectorAll<HTMLButtonElement>('[data-tick]');
        expect(ticks).toHaveLength(21);
        for (const tick of ticks) {
            const value = Number(tick.dataset.tick);
            expect(tick.dataset.tickLabel).toBe(value % 10 === 0 ? 'ten' : 'five');
            act(() => tick.click());
            expect(scale.onChange).toHaveBeenLastCalledWith('heater', value);
        }
        scale.render({ ...scale.props, value: 55 });
        expect(scale.container.querySelector('[aria-pressed="true"]')?.textContent).toBe('55');
        scale.unmount();
    });

    it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'focusout'])(
        '드래그는 1단위이고 중간값은 안 보내며 %s에서만 보낸다',
        async (event) => {
            const send = vi.fn(async (cmd: { heater?: number }) => cmd);
            const sender = createControlSender({ send });
            const onChange = vi.fn((role: ControlRole, value: number) => sender.queue(role, value));
            const scale = renderScale({
                onChange,
                onCommit: () => void sender.commitNow(),
            });
            const input = scale.container.querySelector('input[type="range"]') as HTMLInputElement;
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            for (const value of ['52', '83']) {
                act(() => {
                    setValue?.call(input, value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }
            expect(send).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
            await act(async () => input.dispatchEvent(new Event(event, { bubbles: true })));
            expect(onChange).toHaveBeenCalledExactlyOnceWith('heater', 83);
            expect(send).toHaveBeenCalledExactlyOnceWith({ heater: 83 }, undefined, 'manual', undefined);
            scale.unmount();
        },
    );

    it('드래그 중에는 기기 n을 숨기고 손 뗄 때 보여준다', () => {
        const scale = renderScale({ value: 70, feedback: 70 });
        const input = scale.container.querySelector('input[type="range"]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => {
            setValue?.call(input, '83');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(scale.container.textContent).not.toMatch(/기기/);
        expect(scale.container.querySelector('[data-live-line]')).toBeNull();
        expect((scale.container.querySelector('[data-heater-input]') as HTMLInputElement).value).toBe('83');
        act(() => input.dispatchEvent(new Event('pointerup', { bubbles: true })));
        scale.render({ ...scale.props, value: 83, feedback: 70 });
        expect(scale.container.textContent).toContain('기기 70');
        expect(scale.container.querySelector('[data-live-line]')).not.toBeNull();
        scale.unmount();
    });

    it('드래그 중 잠기면 종료 이벤트로 전송하지 않는다', () => {
        const scale = renderScale();
        scale.render({ ...scale.props, disabled: true });
        const input = scale.container.querySelector('input[type="range"]') as HTMLInputElement;
        expect(input.disabled).toBe(true);
        act(() => {
            input.dispatchEvent(new Event('pointerup', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        });
        expect(scale.onChange).not.toHaveBeenCalled();
        expect(scale.onCommit).not.toHaveBeenCalled();
        scale.unmount();
    });

    it('큰 숫자 입력은 Enter에서만 보낸다', async () => {
        const send = vi.fn(async (cmd: { heater?: number }) => cmd);
        const sender = createControlSender({ send });
        const onChange = vi.fn((role: ControlRole, value: number) => sender.queue(role, value));
        const scale = renderScale({
            onChange,
            onCommit: () => void sender.commitNow(),
        });
        const input = scale.container.querySelector('[data-heater-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '5');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            setValue?.call(input, '53');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(send).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect((scale.container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('70');
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('heater', 53);
        expect(send).toHaveBeenCalledExactlyOnceWith({ heater: 53 }, undefined, 'manual', undefined);
        scale.unmount();
    });

    it('큰 숫자 입력에서 포커스를 벗어나면 전송 없이 취소한다', () => {
        const scale = renderScale();
        const input = scale.container.querySelector('[data-heater-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '53');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => input.blur());
        expect(input.value).toBe('70');
        expect((scale.container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('70');
        expect(scale.onChange).not.toHaveBeenCalled();
        expect(scale.onCommit).not.toHaveBeenCalled();
        scale.unmount();
    });

    it('큰 숫자 입력의 화살표는 1단위로 수정하고 확정 전에는 막대를 움직이지 않는다', () => {
        const scale = renderScale();
        const input = scale.container.querySelector('[data-heater-input]') as HTMLInputElement;
        const slider = scale.container.querySelector('input[type="range"]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '58');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
        expect(input.value).toBe('59');
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        expect(input.value).toBe('58');
        expect(slider.value).toBe('70');
        expect(scale.onChange).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(scale.onChange).toHaveBeenCalledExactlyOnceWith('heater', 58);
        expect(scale.onCommit).toHaveBeenCalledTimes(1);
        scale.unmount();
    });

    it('큰 숫자 입력은 글자를 버리고 min/max로 자른다', async () => {
        const send = vi.fn(async (cmd: { heater?: number }) => cmd);
        const sender = createControlSender({ send });
        const scale = renderScale({
            onChange: (role, value) => sender.queue(role, value),
            onCommit: () => void sender.commitNow(),
        });
        const input = scale.container.querySelector('[data-heater-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => {
            setValue?.call(input, '12a9');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('129');
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(send).toHaveBeenCalledExactlyOnceWith({ heater: 100 }, undefined, 'manual', undefined);
        scale.unmount();
    });

    it('Escape는 입력을 취소하고 전송하지 않는다', () => {
        const scale = renderScale();
        const input = scale.container.querySelector('[data-heater-input]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => input.focus());
        act(() => {
            setValue?.call(input, '40');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(scale.onCommit).not.toHaveBeenCalled();
        expect(scale.onChange).not.toHaveBeenCalled();
        expect(input.value).toBe('70');
        scale.unmount();
    });

    it('±5를 누르고 있으면 반복한다', () => {
        vi.useFakeTimers();
        const { container, onChange, unmount } = renderScale({ value: 70, feedback: 70 });
        const plus = container.querySelector('[data-step="5"]') as HTMLButtonElement;
        act(() => plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        expect(onChange).toHaveBeenCalledTimes(1);
        act(() => {
            vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS);
        });
        expect(onChange.mock.calls.length).toBeGreaterThan(1);
        act(() => plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
        unmount();
        vi.useRealTimers();
    });
});
