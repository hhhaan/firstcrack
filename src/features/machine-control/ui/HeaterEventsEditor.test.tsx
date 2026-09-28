// @vitest-environment jsdom

import { logger } from '@shared/lib/logger';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaterEventsEditor } from './HeaterEventsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('HeaterEventsEditor', () => {
    let host: HTMLDivElement;

    afterEach(() => {
        vi.restoreAllMocks();
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
    it.each(['', '101'])('rejects an invalid heater value: %s', async (value) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'tsv',
                    unit: 'C',
                    onClose: () => {},
                    onApply,
                }),
            ),
        );
        const input = host.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.invalid');
        await act(async () => root.unmount());
    });

    it('converts the default BT rule from Fahrenheit and keeps edits after a failed save', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn().mockRejectedValue(new Error('offline'));
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [],
                    tpTime: 60,
                    btPoints: [],
                    source: null,
                    unit: 'F',
                    onClose: () => {},
                    onApply,
                }),
            ),
        );
        await act(async () =>
            [...host.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.ruleAdd')?.click(),
        );
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply.mock.calls[0][0][0].bt).toBeCloseTo(192);
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.saveFailed');
        expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(host.querySelector('fieldset')?.disabled).toBe(false);
        await act(async () => root.unmount());
    });

    it('rejects heater above device max', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'tsv',
                    unit: 'C',
                    heaterMin: 1,
                    heaterMax: 100,
                    onClose: () => {},
                    onApply,
                }),
            ),
        );
        const input = host.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '150');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.invalid');
        expect(input.value).toBe('150');
        await act(async () => root.unmount());
    });

    it('mode=profile with no bounds rejects heater 150', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    onClose: () => {},
                    onApply,
                }),
            ),
        );
        const input = host.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '150');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...host.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.invalid');
        expect(input.value).toBe('150');
        await act(async () => root.unmount());
    });

    it('rejects a heater that is not on the device step', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'tsv',
                    unit: 'C',
                    heaterMin: 1,
                    heaterMax: 100,
                    heaterStep: 1,
                    onClose: () => {},
                    onApply,
                }),
            ),
        );
        const input = host.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '50.5');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.invalid');
        await act(async () => root.unmount());
    });

    it('시각 칸에 1234를 치면 12:34가 되고 커서가 콜론 뒤로 넘어간다', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events: [{ t: 16, bt: 180, heater: 65, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    onClose: () => {},
                    onApply: () => {},
                }),
            ),
        );
        const input = host.querySelector('tbody input[aria-label="heaterEventsEditor.time"]') as HTMLInputElement;
        const type = async (data: string, inputType = 'insertText') => {
            input.focus();
            await act(async () => {
                input.dispatchEvent(
                    new InputEvent('beforeinput', { bubbles: true, cancelable: true, data, inputType }),
                );
            });
        };
        input.focus();
        input.setSelectionRange(0, input.value.length);
        await act(async () => {
            input.setSelectionRange(0, input.value.length);
            input.dispatchEvent(
                new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'deleteContentBackward',
                }),
            );
        });
        expect(input.value).toBe('');
        await type('1');
        await type('2');
        expect(input.value).toBe('12:');
        expect(input.selectionStart).toBe(3);
        await type('3');
        await type('4');
        expect(input.value).toBe('12:34');
        expect(input.selectionStart).toBe(5);
        await act(async () => root.unmount());
    });

    it('beforeinput을 건너뛴 시간 입력을 보존하고 한 번 보고한다', async () => {
        const capture = vi.spyOn(logger, 'capture').mockImplementation(() => {});
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events: [{ t: 16, bt: 180, heater: 65, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    onClose: () => {},
                    onApply: () => {},
                }),
            ),
        );
        const input = host.querySelector('tbody input[aria-label="heaterEventsEditor.time"]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            setValue?.call(input, '9:00');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('9:00');
        expect(capture).toHaveBeenCalledOnce();
        await act(async () => root.unmount());
    });
    it('history mode edits values of fixed rows only and surfaces the mapped save error', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn().mockRejectedValue({ code: 'PT409' });
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'history',
                    events: [
                        { t: 0, bt: 200, heater: 7 },
                        { t: 120, bt: 150, heater: 5 },
                    ],
                    tpTime: 60,
                    btPoints: [],
                    source: 'tsv',
                    unit: 'C',
                    heaterMin: 0,
                    heaterMax: 10,
                    heaterUnit: 'kPa',
                    heaterStep: 0.5,
                    saveErrorMessage: () => 'conflict',
                    onClose: () => {},
                    onApply,
                }),
            ),
        );
        const texts = [...host.querySelectorAll('button')].map((b) => b.textContent);
        expect(texts).not.toContain('heaterEventsEditor.addStep');
        expect(texts).not.toContain('heaterEventsEditor.ruleAdd');
        expect(host.querySelector('[aria-label="heaterEventsEditor.deleteRow"]')).toBeNull();
        expect(host.textContent).toContain('heaterEventsEditor.subtitleHistory');

        const setHeat = async (value: string) => {
            const input = host.querySelectorAll(
                'tbody input[aria-label="heaterEventsEditor.heat"]',
            )[1] as HTMLInputElement;
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        const save = () =>
            act(async () =>
                [...host.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
            );

        await setHeat('50');
        await save();
        expect(onApply).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.invalid');

        await setHeat('6.5');
        await save();
        expect(onApply.mock.calls[0][0].map((e: { heater: number }) => e.heater)).toEqual([7, 6.5]);
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('conflict');
        expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
        await act(async () => root.unmount());
    });
    it.each([
        ['heat', 'NaN', '80'],
        ['heat', '-5', '80'],
        ['heat', '12.345', '80'],
        ['heat', '12.5', '12.5'],
        ['bt', '1e3', '180'],
        ['bt', '181.25', '180'],
        ['bt', '181.2', '181.2'],
    ])('limits the %s field format: %s → %s', async (field, typed, expected) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'tsv',
                    unit: 'C',
                    onClose: () => {},
                    onApply: vi.fn(),
                }),
            ),
        );
        const input = host.querySelector(`tbody input[aria-label="heaterEventsEditor.${field}"]`) as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, typed);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe(expected);
        await act(async () => root.unmount());
    });
});
