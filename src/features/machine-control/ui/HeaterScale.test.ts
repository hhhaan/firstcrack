// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlSender } from '../lib/controlSender';
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
        unacknowledged: false,
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
        expect(send).toHaveBeenCalledWith({ heater: 90 });
        unmount();
    });

    it('±5는 5%로 스냅한 뒤 즉시 커밋한다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ value: 73, feedback: 73 });
        act(() => (container.querySelector('[data-step="5"]') as HTMLButtonElement).click());
        expect(onChange).toHaveBeenCalledWith('heater', 80);
        expect(onCommit).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('키보드 위/아래는 5%로 스냅한 뒤 커밋한다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ value: 70, feedback: 70 });
        const slider = container.querySelector('[role="slider"]') as HTMLElement;
        act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        });
        expect(onChange).toHaveBeenCalledWith('heater', 75);
        expect(onCommit).toHaveBeenCalledTimes(1);
        act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        expect(onChange).toHaveBeenLastCalledWith('heater', 65);
        unmount();
    });

    it('지시 중이면 큰 숫자는 desired, 라이브 라인과 기기 n은 feedback', () => {
        const { container, unmount } = renderScale({ value: 80, feedback: 60 });
        expect(container.textContent).toContain('80');
        expect(container.textContent).toContain('기기 60');
        expect(container.querySelector('[data-live-line]')).not.toBeNull();
        unmount();
    });

    it('수렴하면 라이브 라인과 기기 n을 숨긴다', () => {
        const { container, unmount } = renderScale({ value: undefined, feedback: 80 });
        expect(container.textContent).toContain('80');
        expect(container.textContent).not.toMatch(/기기/);
        expect(container.querySelector('[data-live-line]')).toBeNull();
        unmount();
    });

    it('미반영이면 라이브 라인이 red-500이다', () => {
        const { container, unmount } = renderScale({ value: 80, feedback: 60, unacknowledged: true });
        expect(container.querySelector('[data-live-line]')?.className).toMatch(/red-500/);
        unmount();
    });

    it('따라오는 중이면 라이브 라인은 muted이다', () => {
        const { container, unmount } = renderScale({ value: 80, feedback: 60, unacknowledged: false });
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

    it('disabled면 탭·±5가 나가지 않는다', () => {
        const { container, onChange, onCommit, unmount } = renderScale({ disabled: true, lockedNote: 'PID' });
        act(() => (container.querySelector('[data-tick="50"]') as HTMLButtonElement).click());
        act(() => (container.querySelector('[data-step="5"]') as HTMLButtonElement).click());
        expect(onChange).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
        expect(container.textContent).toContain('PID');
        unmount();
    });

    it('10의 배수만 숫자 라벨로 보여 주고 5는 눈금만 둔다', () => {
        const { container, unmount } = renderScale();
        expect(container.querySelector('[data-tick="90"]')?.textContent).toContain('90');
        expect(container.querySelector('[data-tick="95"]')?.textContent?.trim()).toBe('');
        unmount();
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
