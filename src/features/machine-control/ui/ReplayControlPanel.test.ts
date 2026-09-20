// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { useReplayControl } from '../model/useReplayControl';
import { ReplayControlPanel } from './ReplayControlPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Replay = ReturnType<typeof useReplayControl>;

const replayStub = (over: Partial<Replay> = {}): Replay =>
    ({
        available: true,
        machineMismatch: false,
        blocked: false,
        active: false,
        stopReason: null,
        nextEvent: null,
        observationHold: false,
        toggle: vi.fn(),
        stop: vi.fn(),
        ...over,
    }) as Replay;

const renderPanel = (replay: Replay) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(ReplayControlPanel, { replay, unit: 'C' })));
    return {
        container,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('ReplayControlPanel 무효 관측 대기 (R05)', () => {
    it('보류 중에는 정상 On이 아니라 온도 데이터 확인 대기를 보여 준다', () => {
        const { container, unmount } = renderPanel(
            replayStub({
                active: true,
                observationHold: true,
                nextEvent: { t: 30, bt: 140, heater: 70 },
            }),
        );
        expect(container.textContent).toContain('온도 데이터 확인 대기');
        expect(container.textContent).not.toContain('On');
        expect(container.textContent).not.toContain('다음: BT');
        expect(container.querySelector('.text-emerald-500')).toBeNull();
        unmount();
    });

    it('정상 재생 중에는 다음 이벤트와 On을 보여 준다', () => {
        const { container, unmount } = renderPanel(
            replayStub({
                active: true,
                observationHold: false,
                nextEvent: { t: 30, bt: 140, heater: 70 },
            }),
        );
        expect(container.textContent).toContain('On');
        expect(container.textContent).toContain('다음: BT');
        expect(container.textContent).not.toContain('온도 데이터 확인 대기');
        unmount();
    });
});

describe('ReplayControlPanel 장기 센서 공백 중지 (R06)', () => {
    it('중지 사유와 현재 화력 확인 안내를 보여주고 짧은 보류 문구와 구분한다', () => {
        const { container, unmount } = renderPanel(
            replayStub({
                active: false,
                stopReason: 'observationStale',
            }),
        );
        expect(container.textContent).toContain('Off');
        expect(container.textContent).toContain('온도 데이터가 끊겨 재생 중지');
        expect(container.textContent).toContain('현재 화력을 확인하세요');
        expect(container.textContent).not.toContain('온도 데이터 확인 대기');
        expect(container.textContent).not.toContain('On');
        unmount();
    });
});
