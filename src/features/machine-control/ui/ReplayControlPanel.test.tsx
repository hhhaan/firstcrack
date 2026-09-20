// @vitest-environment jsdom

import i18n from 'i18next';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import type { useReplayControl } from '../model/useReplayControl';
import { ReplayControlPanel } from './ReplayControlPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Replay = ReturnType<typeof useReplayControl>;

const btEvent = { t: 120, bt: 110, heater: 60 };
const timeEvent = { t: 0, bt: 180, heater: 80 };

const baseReplay = (over: Partial<Replay> = {}): Replay =>
    ({
        available: true,
        machineMismatch: false,
        blocked: false,
        active: true,
        stopReason: null,
        tpUnconfirmedLock: false,
        nextEvent: btEvent,
        tpTime: 60,
        confirmedTurningPoint: null,
        toggle: () => {},
        stop: () => {},
        ...over,
    }) as Replay;

const mount = async (replay: Replay) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(createElement(I18nextProvider, { i18n }, createElement(ReplayControlPanel, { replay, unit: 'C' })));
    });
    return {
        container,
        rerender: (next: Replay) =>
            act(() =>
                root.render(
                    createElement(
                        I18nextProvider,
                        { i18n },
                        createElement(ReplayControlPanel, { replay: next, unit: 'C' }),
                    ),
                ),
            ),
        unmount: () => act(() => root.unmount()),
    };
};

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
        const { container, unmount } = await mount(baseReplay({ confirmedTurningPoint: null }));
        expect(container.textContent).toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('다음: BT');
        const status = container.querySelector('[data-replay-status]');
        expect(status?.getAttribute('data-replay-status')).toBe('waiting');
        expect(status?.className).toContain('text-amber');
        expect(status?.className).not.toContain('text-emerald');
        unmount();
    });

    it('fallback을 실감지 상승 증거로 표시하지 않는다', async () => {
        const { container, unmount } = await mount(baseReplay({ confirmedTurningPoint: { fallback: true } }));
        expect(container.textContent).toContain('not a detected rise');
        expect(container.textContent).not.toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('다음: BT');
        const status = container.querySelector('[data-replay-status]');
        expect(status?.getAttribute('data-replay-status')).toBe('fallback');
        expect(status?.className).toContain('text-amber');
        unmount();
    });

    it('실감지면 다음 BT 이벤트를 정상 표시한다', async () => {
        const { container, unmount } = await mount(baseReplay({ confirmedTurningPoint: { fallback: false } }));
        expect(container.textContent).toContain('다음: BT');
        expect(container.textContent).toContain('110');
        expect(container.textContent).not.toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('not a detected rise');
        const status = container.querySelector('[data-replay-status]');
        expect(status?.getAttribute('data-replay-status')).toBe('running');
        expect(status?.className).toContain('text-emerald');
        unmount();
    });

    it('다음이 TIME이면 TP 대기 문구를 붙이지 않는다', async () => {
        const { container, unmount } = await mount(baseReplay({ nextEvent: timeEvent, confirmedTurningPoint: null }));
        expect(container.textContent).not.toContain('Waiting for a real turning point');
        expect(container.textContent).not.toContain('not a detected rise');
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('running');
        // 다음 이벤트 줄은 유지 — 트리거 라벨(TIME/BT)은 R07. BT(180) 부분문자열로 히터(80)를 통과시키지 않는다.
        expect(container.textContent).toContain(`→ ${timeEvent.heater}%`);
        unmount();
    });

    it('fallback → 실감지 승격 시 표시가 바뀐다', async () => {
        const { container, rerender, unmount } = await mount(baseReplay({ confirmedTurningPoint: { fallback: true } }));
        expect(container.textContent).toContain('not a detected rise');
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('fallback');
        await rerender(baseReplay({ confirmedTurningPoint: { fallback: false } }));
        expect(container.textContent).not.toContain('not a detected rise');
        expect(container.textContent).toContain('다음: BT');
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('running');
        unmount();
    });
});

describe('ReplayControlPanel TP unconfirmed handoff (#368 R09)', () => {
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

    it('중단 경고는 Replay OFF ≠ 버너 OFF를 설명하고, 실감지 전에는 재토글이 막힌다', async () => {
        const { container, rerender, unmount } = await mount(
            baseReplay({
                active: false,
                stopReason: 'tpUnconfirmed',
                tpUnconfirmedLock: true,
                nextEvent: btEvent,
                confirmedTurningPoint: null,
            }),
        );
        expect(container.textContent).toMatch(/not burner off/i);
        expect(container.textContent).toMatch(/check current heat/i);
        expect(container.textContent).toMatch(/resume after a real turning point/i);
        expect(container.querySelector('[data-replay-status]')?.getAttribute('data-replay-status')).toBe('off');
        expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);

        await rerender(
            baseReplay({
                active: false,
                stopReason: 'tpUnconfirmed',
                tpUnconfirmedLock: false,
                nextEvent: btEvent,
                confirmedTurningPoint: { fallback: false },
            }),
        );
        expect(container.textContent).toMatch(/not burner off/i);
        expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false);
        unmount();
    });
});
