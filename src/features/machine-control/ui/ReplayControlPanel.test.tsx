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
import { CollapsedControlStatus } from './CollapsedControlStatus';
import { ReplayControlPanel } from './ReplayControlPanel';
import panelSrc from './ReplayControlPanel.tsx?raw';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Replay = ReturnType<typeof useReplayControl>;

const btEvent = { t: 120, bt: 110, heater: 60 };
const timeEvent = { t: 0, bt: 180, heater: 80 };

const baseReplay = (over: Partial<Replay> = {}): Replay =>
    ({
        available: true,
        machineMismatch: false,
        referenceLoading: false,
        missingHeatSet: false,
        blocked: false,
        active: true,
        stopReason: null,
        nextEvent: null,
        nextEventTrigger: null,
        observationHold: false,
        tpTime: 60,
        confirmedTurningPoint: { fallback: false },
        toggle: () => {},
        stop: () => {},
        ...over,
    }) as Replay;

const mount = async (props: { replay?: Replay; unit?: 'C' | 'F'; heaterUnit?: string; folded?: boolean }) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (next: { replay?: Replay; unit?: 'C' | 'F'; heaterUnit?: string }) =>
        act(() => {
            root.render(
                createElement(
                    I18nextProvider,
                    { i18n },
                    props.folded
                        ? createElement(CollapsedControlStatus, {
                              pidState: 'off',
                              anyUnacknowledged: false,
                              replay: next.replay ?? baseReplay(),
                          })
                        : createElement(ReplayControlPanel, {
                              replay: next.replay ?? baseReplay(),
                              unit: next.unit ?? 'C',
                              heaterUnit: next.heaterUnit,
                          }),
                ),
            );
        });
    await render(props);
    return {
        container,
        rerender: (replay: Replay) => render({ ...props, replay }),
        unmount: () => act(() => root.unmount()),
    };
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

    it('표시는 판정 helper에서 파생하고 TIME/BT를 패널에서 다시 분류하지 않는다', () => {
        expect(panelSrc).toMatch(/formatReplayCondition/);
        expect(panelSrc).toMatch(/nextEventTrigger/);
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

describe('ReplayControlPanel TP wait (#368 R08)', () => {
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

    it('다음이 BT이고 TP가 없으면 실제 TP 대기를 보여 주고 정상 재생처럼 보이지 않는다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: btEvent,
                nextEventTrigger: 'bt',
                confirmedTurningPoint: null,
            }),
        });
        expect(container.textContent).toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('BT 110');
        const status = container.querySelector('[data-replay-status]');
        expect(status?.getAttribute('data-replay-status')).toBe('waiting');
        expect(status?.className).toContain('text-amber');
        expect(status?.className).not.toContain('text-emerald');
        unmount();
    });

    it.each([false, true])('uses explicit conditions for TP hold with folded=%s', async (folded) => {
        const { container, rerender, unmount } = await mount({
            folded,
            replay: baseReplay({
                nextEvent: { ...timeEvent, trigger: 'bt' },
                nextEventTrigger: 'bt',
                confirmedTurningPoint: null,
            }),
        });
        if (folded)
            expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
                en.activeRoast.replay.tp.collapsedWaiting,
            );
        else
            expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('waiting');
        await rerender(
            baseReplay({
                nextEvent: { ...btEvent, trigger: 'time' },
                nextEventTrigger: 'time',
                confirmedTurningPoint: { fallback: true },
            }),
        );
        if (folded) expect(container.querySelector('[role="img"]')?.className).toContain('bg-emerald');
        else
            expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('running');
        unmount();
    });

    it('fallback을 실감지 상승 증거로 표시하지 않는다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: btEvent,
                nextEventTrigger: 'bt',
                confirmedTurningPoint: { fallback: true },
            }),
        });
        expect(container.textContent).toContain('not a detected rise');
        expect(container.textContent).not.toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('BT 110');
        const status = container.querySelector('[data-replay-status]');
        expect(status?.getAttribute('data-replay-status')).toBe('fallback');
        expect(status?.className).toContain('text-amber');
        unmount();
    });

    it('실감지면 다음 BT 이벤트를 정상 표시한다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: btEvent,
                nextEventTrigger: 'bt',
                confirmedTurningPoint: { fallback: false },
            }),
        });
        expect(container.textContent).toContain('BT 110');
        expect(container.textContent).not.toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('not a detected rise');
        const status = container.querySelector('[data-replay-status]');
        expect(status?.getAttribute('data-replay-status')).toBe('running');
        expect(status?.className).toContain('text-emerald');
        unmount();
    });

    it('다음이 TIME이면 TP 대기 문구를 붙이지 않는다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({
                nextEvent: timeEvent,
                nextEventTrigger: 'time',
                confirmedTurningPoint: null,
            }),
        });
        expect(container.textContent).not.toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('not a detected rise');
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('running');
        expect(container.textContent).toContain(`→ ${timeEvent.heater}%`);
        unmount();
    });

    it('fallback → 실감지 승격 시 표시가 바뀐다', async () => {
        const fallback = baseReplay({
            nextEvent: btEvent,
            nextEventTrigger: 'bt',
            confirmedTurningPoint: { fallback: true },
        });
        const { container, rerender, unmount } = await mount({ replay: fallback });
        expect(container.textContent).toContain('not a detected rise');
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('fallback');
        await rerender(
            baseReplay({
                nextEvent: btEvent,
                nextEventTrigger: 'bt',
                confirmedTurningPoint: { fallback: false },
            }),
        );
        expect(container.textContent).not.toContain('not a detected rise');
        expect(container.textContent).toContain('BT 110');
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('running');
        unmount();
    });
});
