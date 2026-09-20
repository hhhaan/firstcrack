// @vitest-environment jsdom

import i18n from 'i18next';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import ja from '../../../shared/i18n/locales/ja.json';
import ko from '../../../shared/i18n/locales/ko.json';
import zhCN from '../../../shared/i18n/locales/zh-CN.json';
import type { ReplayEvent } from '../lib/replay';
import type { useReplayControl } from '../model/useReplayControl';
import { ReplayControlPanel } from './ReplayControlPanel';
import panelSrc from './ReplayControlPanel.tsx?raw';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Replay = ReturnType<typeof useReplayControl>;

const baseReplay = (over: Partial<Replay> = {}): Replay =>
    ({
        available: true,
        machineMismatch: false,
        blocked: false,
        active: true,
        stopReason: null,
        nextEvent: null,
        nextEventTrigger: null,
        toggle: () => {},
        stop: () => {},
        ...over,
    }) as Replay;

const mount = async (props: { replay?: Replay; unit?: 'C' | 'F'; heaterUnit?: string }) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(
            createElement(
                I18nextProvider,
                { i18n },
                createElement(ReplayControlPanel, {
                    replay: props.replay ?? baseReplay(),
                    unit: props.unit ?? 'C',
                    heaterUnit: props.heaterUnit,
                }),
            ),
        );
    });
    return { container, unmount: () => act(() => root.unmount()) };
};

const event = (over: Partial<ReplayEvent>): ReplayEvent => ({ t: 0, bt: 180, heater: 80, ...over });

describe('ReplayControlPanel next-event display (R07)', () => {
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

    it('TP 이전 TIME 이벤트는 TIME mm:ss 이고 BT 온도를 쓰지 않는다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: event({ t: 40, bt: 140, heater: 70 }),
                nextEventTrigger: 'time',
            }),
        });
        expect(container.textContent).toContain('TIME 0:40');
        expect(container.textContent).not.toContain('BT 140');
        expect(container.textContent).toContain('70%');
        unmount();
    });

    it('TP와 같은 시각도 TIME이다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: event({ t: 60, bt: 95, heater: 65 }),
                nextEventTrigger: 'time',
            }),
        });
        expect(container.textContent).toContain('TIME 1:00');
        expect(container.textContent).not.toContain('BT 95');
        unmount();
    });

    it('TP 이후 BT 이벤트는 온도이고 원본 시각을 트리거처럼 보여 주지 않는다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: event({ t: 120, bt: 107.4, heater: 60 }),
                nextEventTrigger: 'bt',
            }),
        });
        expect(container.textContent).toContain('BT 107°C');
        expect(container.textContent).not.toContain('TIME');
        expect(container.textContent).not.toContain('2:00');
        unmount();
    });

    it('BT 표시는 °F 설정을 따른다', async () => {
        const { container, unmount } = await mount({
            unit: 'F',
            replay: baseReplay({
                nextEvent: event({ t: 200, bt: 100, heater: 50 }),
                nextEventTrigger: 'bt',
            }),
        });
        expect(container.textContent).toContain('BT 212°F');
        unmount();
    });

    it('이벤트를 소진하면 done 카피를 보여 준다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({ nextEvent: null, nextEventTrigger: null }),
        });
        expect(container.textContent).toContain('All events replayed');
        unmount();
    });

    it('화력은 percent/% 와 native-step을 구분한다', async () => {
        const percent = await mount({
            heaterUnit: '%',
            replay: baseReplay({
                nextEvent: event({ t: 40, bt: 140, heater: 70 }),
                nextEventTrigger: 'time',
            }),
        });
        expect(percent.container.textContent).toContain('70%');
        percent.unmount();

        const step = await mount({
            heaterUnit: 'step',
            replay: baseReplay({
                nextEvent: event({ t: 40, bt: 140, heater: 7 }),
                nextEventTrigger: 'time',
            }),
        });
        expect(step.container.textContent).toContain('7step');
        expect(step.container.textContent).not.toContain('7%');
        step.unmount();
    });

    it('표시는 판정 helper에서 파생하고 패널에서 TP를 다시 분류하지 않는다', () => {
        expect(panelSrc).toMatch(/formatReplayCondition/);
        expect(panelSrc).toMatch(/nextEventTrigger/);
        expect(panelSrc).not.toMatch(/tpTime/);
        expect(panelSrc).not.toMatch(/event\.t\s*<=/);
    });

    it('next locale 문자열은 condition/heater를 보간한다', () => {
        for (const [lng, next] of [
            ['en', en.activeRoast.replay.next],
            ['ko', ko.activeRoast.replay.next],
            ['ja', ja.activeRoast.replay.next],
            ['zh-CN', zhCN.activeRoast.replay.next],
        ] as const) {
            expect(next, lng).toContain('{{condition}}');
            expect(next, lng).toContain('{{heater}}');
            expect(next, lng).not.toContain('{{temp}}');
        }
    });
});
