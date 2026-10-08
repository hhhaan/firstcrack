// @vitest-environment jsdom

import { logger } from '@shared/lib/logger';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heaterEventsToJson, parseHeaterEvents } from '../lib/heater-events';
import { HeaterEventsEditor } from './HeaterEventsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    }),
}));

describe('HeaterEventsEditor', () => {
    let host: HTMLDivElement;

    it.each(['time', 'bt'] as const)('applies an 80 to 0 OFF plan with %s trigger', async (trigger) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        const events = [{ t: 0, bt: 100, heater: 80, trigger: 'time' as const }];
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events,
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    heaterMin: 0,
                    heaterMax: 100,
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        if (trigger === 'time') {
            await act(async () => {
                [...document.querySelectorAll('button')]
                    .find((b) => b.textContent === 'heaterEventsEditor.addStep')
                    ?.click();
            });
        }
        const heatInputs = document.querySelectorAll<HTMLInputElement>(
            trigger === 'bt'
                ? '[aria-labelledby="heater-events-rule-title"] input[aria-label="heaterEventsEditor.heat"]'
                : 'tbody input[aria-label="heaterEventsEditor.heat"]',
        );
        const heat = heatInputs[heatInputs.length - 1];
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(heat, '0');
            heat.dispatchEvent(new Event('input', { bubbles: true }));
        });
        if (trigger === 'bt') {
            await act(async () => {
                [...document.querySelectorAll('button')]
                    .find((b) => b.textContent === 'heaterEventsEditor.ruleAdd')
                    ?.click();
            });
        }
        const apply = [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save');
        expect(apply).toBeDefined();
        await act(async () => apply?.click());
        expect(onApply).toHaveBeenCalledOnce();
        const saved = parseHeaterEvents(heaterEventsToJson(onApply.mock.calls[0][0]));
        expect(saved?.map((e) => e.heater)).toEqual([80, 0]);
        expect(saved?.[1].trigger).toBe(trigger);
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    key: 'reopened',
                    mode: 'profile',
                    events: saved ?? [],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    heaterMin: 0,
                    heaterMax: 100,
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        expect(
            [...document.querySelectorAll<HTMLInputElement>('tbody input[aria-label="heaterEventsEditor.heat"]')].map(
                (input) => input.value,
            ),
        ).toEqual(['80', '0']);
        await act(async () => root.unmount());
    });

    it('keeps the editor open and names an all-zero plan separately from a range error', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events: [{ t: 0, bt: 180, heater: 80, trigger: 'time' as const }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    heaterMin: 0,
                    heaterMax: 100,
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '0');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="heater-events-editor"]')).not.toBeNull();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.allZero');
        await act(async () => root.unmount());
    });

    it('names an unfinished m:ss time instead of a generic value error', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events: [{ t: 16, bt: 180, heater: 65, trigger: 'time' as const }],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    heaterMin: 0,
                    heaterMax: 100,
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.time"]') as HTMLInputElement;
        input.focus();
        input.setSelectionRange(0, input.value.length);
        await act(async () => {
            input.dispatchEvent(
                new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'deleteContentBackward',
                }),
            );
        });
        const type = async (data: string) => {
            input.focus();
            await act(async () => {
                input.dispatchEvent(
                    new InputEvent('beforeinput', { bubbles: true, cancelable: true, data, inputType: 'insertText' }),
                );
            });
        };
        await type('1');
        await type('2');
        expect(input.value).toBe('12:');
        await act(async () =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.timeInvalid|{"row":1}');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        await act(async () => root.unmount());
    });

    it('집중 모드 차트(z-9999)보다 위에 연다', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [],
                    tpTime: 60,
                    btPoints: [],
                    source: null,
                    unit: 'C',
                    onClose: () => {},
                    onApply: () => {},
                }),
            );
        });
        const overlay = document.body.querySelector('[role="presentation"]');
        expect(overlay?.className).toContain('z-[10000]');
        await act(async () => root.unmount());
    });

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
        const addBt = [...document.querySelectorAll('button')].find(
            (b) => b.textContent === 'heaterEventsEditor.ruleAdd',
        );
        await act(async () => {
            addBt?.click();
        });
        const apply = [...document.querySelectorAll('button')].find(
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
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        const alert = document.querySelector('[role="alert"]')?.textContent;
        expect(alert).toBe(
            value === ''
                ? 'heaterEventsEditor.heatEmpty|{"row":1}'
                : 'heaterEventsEditor.heatRange|{"row":1,"min":0,"max":100,"unit":"%"}',
        );
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
            [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.ruleAdd')
                ?.click(),
        );
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply.mock.calls[0][0][0].bt).toBeCloseTo(192);
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('heaterEventsEditor.saveFailed');
        expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(document.querySelector('fieldset')?.disabled).toBe(false);
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
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '150');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            'heaterEventsEditor.heatRange|{"row":1,"min":1,"max":100,"unit":"%"}',
        );
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
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '150');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            'heaterEventsEditor.heatRange|{"row":1,"min":0,"max":100,"unit":"%"}',
        );
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
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.heat"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '50.5');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () =>
            [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'heaterEventsEditor.applyBatch')
                ?.click(),
        );
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            'heaterEventsEditor.heatStep|{"row":1,"step":1,"unit":"%"}',
        );
        expect(input.getAttribute('aria-invalid')).toBe('true');
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
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.time"]') as HTMLInputElement;
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
        const input = document.querySelector('tbody input[aria-label="heaterEventsEditor.time"]') as HTMLInputElement;
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
        const texts = [...document.querySelectorAll('button')].map((b) => b.textContent);
        expect(texts).not.toContain('heaterEventsEditor.addStep');
        expect(texts).not.toContain('heaterEventsEditor.ruleAdd');
        expect(document.querySelector('[aria-label="heaterEventsEditor.deleteRow"]')).toBeNull();
        expect(document.body.textContent).toContain('heaterEventsEditor.subtitleHistory');

        const setHeat = async (value: string) => {
            const input = document.querySelectorAll(
                'tbody input[aria-label="heaterEventsEditor.heat"]',
            )[1] as HTMLInputElement;
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        const save = () =>
            act(async () =>
                [...document.querySelectorAll('button')]
                    .find((b) => b.textContent === 'heaterEventsEditor.save')
                    ?.click(),
            );

        await setHeat('50');
        await save();
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            'heaterEventsEditor.heatRange|{"row":2,"min":0,"max":10,"unit":"kPa"}',
        );

        await setHeat('6.5');
        await save();
        expect(onApply.mock.calls[0][0].map((e: { heater: number }) => e.heater)).toEqual([7, 6.5]);
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('conflict');
        expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
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
        const input = document.querySelector(
            `tbody input[aria-label="heaterEventsEditor.${field}"]`,
        ) as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, typed);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe(expected);
        await act(async () => root.unmount());
    });
});
