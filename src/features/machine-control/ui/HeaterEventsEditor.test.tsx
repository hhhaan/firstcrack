// @vitest-environment jsdom

import { logger } from '@shared/lib/logger';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heaterEventsToJson, parseHeaterEvents, profileHeaterBounds } from '../lib/heater-events';
import { HeaterEventsEditor } from './HeaterEventsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    }),
}));

describe('HeaterEventsEditor', () => {
    let host: HTMLDivElement;

    it.each([
        ['giesen_standard', 'time'],
        ['giesen_standard', 'bt'],
        ['giesen_w45a_w60a', 'time'],
        ['giesen_w45a_w60a', 'bt'],
        ['giesen_wxa_coarse', 'time'],
        ['giesen_wxa_coarse', 'bt'],
    ] as const)('round-trips a saved %s plan with logical zero and %s trigger', async (key, trigger) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        const max = key === 'giesen_wxa_coarse' ? 10 : 100;
        const unit = key === 'giesen_wxa_coarse' ? 'step' : '%';
        const bounds = profileHeaterBounds(
            { machine_id: key },
            [
                {
                    id: key,
                    roasterKey: key,
                    connectionParams: {
                        write_map: { heater: { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 1, max, unit } },
                    },
                },
            ],
            {},
        );
        const events = [
            { t: 0, bt: 100, heater: max * 0.8, trigger: 'time' as const },
            ...(trigger === 'time' ? [{ t: 120, bt: 150, heater: max * 0.6, trigger: 'time' as const }] : []),
        ];
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events,
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit: 'C',
                    heaterMin: bounds.min,
                    heaterMax: bounds.max,
                    heaterUnit: bounds.unit,
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        expect(document.querySelector('tbody select')).toBeNull();
        expect([...document.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
            'heaterEventsEditor.addStep',
        );
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
        expect(saved?.map((e) => e.heater)).toEqual([max * 0.8, 0]);
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
                    heaterMin: bounds.min,
                    heaterMax: bounds.max,
                    heaterUnit: bounds.unit,
                    onClose: () => {},
                    onApply,
                }),
            );
        });
        expect(
            [...document.querySelectorAll<HTMLInputElement>('tbody input[aria-label="heaterEventsEditor.heat"]')].map(
                (input) => input.value,
            ),
        ).toEqual([String(max * 0.8), '0']);
        expect(document.querySelectorAll('tbody input[aria-label="heaterEventsEditor.time"]')).toHaveLength(
            trigger === 'time' ? 2 : 1,
        );
        expect(document.querySelectorAll('tbody input[aria-label="heaterEventsEditor.bt"]')).toHaveLength(
            trigger === 'bt' ? 1 : 0,
        );
        expect(document.querySelector('tbody select')).toBeNull();
        await act(async () => root.unmount());
    });

    it('shows only the effective criterion and preserves acknowledged row locks', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'batch',
                    events: [
                        { t: 40, bt: 160, heater: 80 },
                        { t: 60, bt: 95, heater: 70 },
                        { t: 120, bt: 150, heater: 60 },
                        { t: 180, bt: 160, heater: 50, trigger: 'time' },
                    ],
                    tpTime: 60,
                    btPoints: [],
                    source: 'tsv',
                    unit: 'C',
                    lockedCount: 1,
                    onClose: () => {},
                    onApply: () => {},
                }),
            ),
        );
        const rows = document.querySelectorAll('tbody tr');
        expect(rows[0].querySelector<HTMLInputElement>('input')?.readOnly).toBe(true);
        expect(rows[0].querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
        expect(rows[1].querySelector('[aria-label="heaterEventsEditor.time"]')).not.toBeNull();
        expect(rows[2].querySelector('[aria-label="heaterEventsEditor.time"]')).toBeNull();
        expect(rows[2].querySelector('[aria-label="heaterEventsEditor.bt"]')).not.toBeNull();
        expect(rows[3].querySelector('[aria-label="heaterEventsEditor.time"]')).not.toBeNull();
        expect(document.querySelectorAll('svg [role="button"]')[2].getAttribute('aria-label')).toBe('BT 150°C, 60%');
        await act(async () => root.unmount());
    });

    it.each(['C', 'F'] as const)('preserves hidden reference precision in %s', async (unit) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () =>
            root.render(
                createElement(HeaterEventsEditor, {
                    mode: 'profile',
                    events: [
                        { t: 40, bt: 160.12345, heater: 80, trigger: 'time' },
                        { t: 120.375, bt: 150, heater: 60, trigger: 'bt' },
                    ],
                    tpTime: 60,
                    btPoints: [],
                    source: 'profile',
                    unit,
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
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        const saved = onApply.mock.calls[0][0];
        expect(saved[0].bt).toBe(160.12345);
        expect(saved[1].t).toBe(120.375);
        expect(saved[2].t).toBe(120.375);
        await act(async () => root.unmount());
    });

    it('saves a lone 0 when the device accepts it', async () => {
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
        expect(onApply).toHaveBeenCalledOnce();
        expect(onApply.mock.calls[0][0].map((event: { heater: number }) => event.heater)).toEqual([0]);
        expect(document.querySelector('[role="alert"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('saves a trailing colon as minutes and zero seconds', async () => {
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
        expect(input.value).toBe('12:00');
        await act(async () =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === 'heaterEventsEditor.save')?.click(),
        );
        expect(onApply).toHaveBeenCalledOnce();
        expect(onApply.mock.calls[0][0][0].t).toBe(720);
        expect(document.querySelector('[role="alert"]')).toBeNull();
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

    it.each(['profile', 'batch'] as const)('adds only BT conditions in %s mode', async (mode) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const onApply = vi.fn();
        await act(async () => {
            root.render(
                createElement(HeaterEventsEditor, {
                    mode,
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
        const added = document.querySelectorAll('tbody tr')[1];
        expect(added.querySelector('[aria-label="heaterEventsEditor.time"]')).toBeNull();
        expect(added.querySelector('[aria-label="heaterEventsEditor.bt"]')).not.toBeNull();
        expect(document.querySelector('tbody select')).toBeNull();
        const apply = [...document.querySelectorAll('button')].find(
            (b) => b.textContent === (mode === 'batch' ? 'heaterEventsEditor.applyBatch' : 'heaterEventsEditor.save'),
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
        expect(input.value).toBe('00:00');
        await type('1');
        await type('2');
        expect(input.value).toBe('12:00');
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
        await act(async () => {
            setValue?.call(input, '9a');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('9:00');
        await act(async () => root.unmount());
    });
    it('history mode edits, adds, and deletes steps and surfaces the mapped save error', async () => {
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
        expect(texts).toContain('heaterEventsEditor.ruleAdd');
        expect(document.querySelector('[aria-label="heaterEventsEditor.deleteRow"]')).not.toBeNull();
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
                    events: [{ t: 0, bt: 180, heater: 80, trigger: field === 'bt' ? 'bt' : 'time' }],
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
