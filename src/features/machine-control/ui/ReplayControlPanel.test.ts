// @vitest-environment jsdom
import i18n from 'i18next';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
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
        nextEventTrigger: null,
        observationHold: false,
        toggle: vi.fn(),
        stop: vi.fn(),
        ...over,
    }) as Replay;

const renderPanel = (replay: Replay) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
        root.render(createElement(I18nextProvider, { i18n }, createElement(ReplayControlPanel, { replay, unit: 'C' }))),
    );
    return {
        container,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('ReplayControlPanel 무효 관측 대기 (R05)', () => {
    beforeAll(async () => {
        if (!i18n.isInitialized) {
            await i18n.init({
                lng: 'en',
                fallbackLng: 'en',
                resources: { en: { translation: en } },
                interpolation: { escapeValue: false },
            });
        }
    });
    it('보류 중에는 정상 On이 아니라 온도 데이터 확인 대기를 보여 준다', () => {
        const { container, unmount } = renderPanel(
            replayStub({
                active: true,
                observationHold: true,
                nextEvent: { t: 30, bt: 140, heater: 70 },
                nextEventTrigger: 'bt',
            }),
        );
        expect(container.textContent).toContain('온도 데이터 확인 대기');
        expect(container.textContent).not.toContain('On');
        expect(container.textContent).not.toContain('BT 140');
        expect(container.querySelector('.text-emerald-500')).toBeNull();
        unmount();
    });

    it('정상 재생 중에는 다음 이벤트와 On을 보여 준다', () => {
        const { container, unmount } = renderPanel(
            replayStub({
                active: true,
                observationHold: false,
                nextEvent: { t: 30, bt: 140, heater: 70 },
                nextEventTrigger: 'bt',
            }),
        );
        expect(container.textContent).toContain('On');
        expect(container.textContent).toContain('BT 140');
        expect(container.textContent).not.toContain('온도 데이터 확인 대기');
        unmount();
    });
});
