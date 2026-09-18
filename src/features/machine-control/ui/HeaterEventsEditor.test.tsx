// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaterEventsEditor } from './HeaterEventsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('HeaterEventsEditor', () => {
    let host: HTMLDivElement;

    afterEach(() => {
        host?.remove();
    });

    it('BT 규칙을 행으로 추가하고 적용한다', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' as const }],
                    tpTime: 60,
                    btPoints: [{ t: 0, bt: 180, heater: 80 }],
                    source: 'tsv',
                    unit: 'C',
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        const addBt = [...host.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.ruleAdd');
        await act(async () => {
            addBt?.click();
        });
        const apply = [...host.querySelectorAll('button')].find(
            (b) => b.textContent === 'heaterEventsEditor.applyBatch',
        );
        await act(async () => {
            apply?.click();
        });
        expect(onApply).toHaveBeenCalled();
        const payload = onApply.mock.calls[0][0] as { bt: number; heater: number; trigger: string }[];
        expect(payload.some((e) => e.trigger === 'bt' && e.heater === 50)).toBe(true);
        await act(async () => root.unmount());
    });
});
