// @vitest-environment jsdom

import i18n from 'i18next';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import type { useReplayControl } from '../model/useReplayControl';
import { ReplayControlPanel } from './ReplayControlPanel';
import panelSrc from './ReplayControlPanel.tsx?raw';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Replay = ReturnType<typeof useReplayControl>;

const baseReplay = (over: Partial<Replay> = {}): Replay =>
    ({
        available: true,
        hasPlan: true,
        sidecarConnected: true,
        heaterWritable: true,
        pidEngaged: false,
        heaterUnacknowledged: false,
        machineMismatch: false,
        blocked: false,
        active: false,
        stopReason: null,
        nextEvent: null,
        toggle: () => {},
        stop: () => {},
        ...over,
    }) as Replay;

const mount = async (props: Partial<Parameters<typeof ReplayControlPanel>[0]> & { replay?: Replay }) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(
            createElement(
                I18nextProvider,
                { i18n },
                createElement(ReplayControlPanel, {
                    replay: props.replay ?? baseReplay(),
                    unit: 'C',
                    dropBehavior: props.dropBehavior ?? 'zero',
                    curveError: props.curveError,
                    roasterKey: props.roasterKey,
                    onOpenRoastSettings: props.onOpenRoastSettings,
                }),
            ),
        );
    });
    return { container, unmount: () => act(() => root.unmount()) };
};

describe('ReplayControlPanel', () => {
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

    it('mismatch 사유를 hover 없이 상시 표시한다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({ available: false, machineMismatch: true, hasPlan: true }),
        });
        expect(container.textContent).toContain('different machine');
        expect(container.querySelector('[role="tooltip"]')).toBeNull();
        unmount();
    });

    it('끊김은 기록 없음과 다른 카피다', async () => {
        const { container, unmount } = await mount({
            replay: baseReplay({ available: false, sidecarConnected: false, hasPlan: true }),
        });
        expect(container.textContent).toContain('disconnected');
        expect(container.textContent).not.toContain('No heater recording');
        unmount();
    });

    it('기센만 Manual 배너를 상시 보여 주고 이지스터에는 없다', async () => {
        const giesen = await mount({ roasterKey: 'giesen_standard' });
        expect(giesen.container.textContent).toContain('Manual');
        giesen.unmount();
        const easy = await mount({ roasterKey: 'easyster' });
        expect(easy.container.textContent).not.toContain('Manual');
        easy.unmount();
    });

    it('배출 정책을 패널에 표시한다', async () => {
        const { container, unmount } = await mount({ dropBehavior: 'zero' });
        expect(container.textContent).toContain('cut to 0');
        unmount();
    });

    it('disabled 힌트에 group-hover를 쓰지 않는다', () => {
        expect(panelSrc).not.toMatch(/disabledHint[\s\S]*group-hover:block/);
        expect(panelSrc).toContain('resolveReplayDisableReason');
    });
});
