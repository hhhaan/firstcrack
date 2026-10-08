// @vitest-environment jsdom
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastLog } from './RoastLog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (event: string, id: string): LogEntry => ({
    id,
    time: '1:00',
    timeSec: 60,
    event,
    temp: '180.0°C',
    tempC: 180,
    note: event === 'Heater' ? '50%' : event === 'Note' ? 'aroma' : '',
});

describe('RoastLog removable entries', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows gas, airflow and drum RPM even without a comment', () => {
        act(() =>
            root.render(
                createElement(RoastLog, {
                    variant: 'main',
                    entries: [{ ...entry('Note', 'manual'), note: '', gas: '0', airflow: '1.2 kPa', drum: '55' }],
                }),
            ),
        );
        expect(container.textContent).toContain('Gas 0 · Airflow 1.2 kPa · Drum 55 RPM');
    });

    it.each(['panel', 'main', 'sidebar'] as const)(
        'keeps %s rows and delete focus stable when reordered',
        (variant) => {
            const onRemoveEntry = vi.fn();
            const first = entry('Note', 'first');
            const second = entry('Note', 'second');
            const now: LogEntry = { time: '1:00', event: 'Now', temp: '180°C', note: '', current: true };
            const render = (entries: LogEntry[]) =>
                act(() => root.render(createElement(RoastLog, { variant, entries, onRemoveEntry })));
            const nowLabel = () => [...container.querySelectorAll('span')].find((el) => el.textContent === 'Now');
            render([first, second, now]);
            const currentLabel = nowLabel();
            const firstDelete = container.querySelector('[aria-label="Delete note"]') as HTMLButtonElement;
            firstDelete.focus();
            render([{ ...now, time: '1:01', temp: '181°C' }, second, first]);
            expect(nowLabel()).toBe(currentLabel);
            expect(document.activeElement).toBe(firstDelete);
            expect(container.querySelectorAll('[aria-label="Delete note"]')[1]).toBe(firstDelete);
            act(() => firstDelete.click());
            expect(onRemoveEntry).toHaveBeenCalledWith('first');
        },
    );

    it('deletes Heater and Note rows, not Charge', () => {
        const onRemoveEntry = vi.fn();
        act(() => {
            root.render(
                createElement(RoastLog, {
                    variant: 'sidebar',
                    onRemoveEntry,
                    entries: [entry('Charge', 'charge-1'), entry('Heater', 'heater-1'), entry('Note', 'note-1')],
                }),
            );
        });

        expect(container.querySelector('[aria-label="Delete charge"]')).toBeNull();
        act(() => {
            (container.querySelector('[aria-label="Delete heater"]') as HTMLButtonElement).click();
        });
        act(() => {
            (container.querySelector('[aria-label="Delete note"]') as HTMLButtonElement).click();
        });
        expect(onRemoveEntry.mock.calls).toEqual([['heater-1'], ['note-1']]);
    });
    it.each(['sidebar', 'main', 'panel'] as const)(
        'edits time and temperature together in %s and cancels without saving',
        (variant) => {
            const onEditEntry = vi.fn();
            act(() =>
                root.render(
                    createElement(RoastLog, {
                        variant,
                        entries: [
                            entry('Charge', 'charge'),
                            entry('FC Start', 'fc'),
                            { ...entry('Now', 'now'), current: true },
                        ],
                        editOptions: {
                            unit: 'F',
                            livePoints: [
                                { time: 50, bt: 170 },
                                { time: 60, bt: 180 },
                                { time: 70, bt: 190 },
                            ],
                            maxTimeSec: 70,
                            onEditEntry,
                        },
                    }),
                ),
            );
            const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]');
            expect(buttons).toHaveLength(1);
            act(() => buttons[0].click());
            const inputs = container.querySelectorAll('input');
            expect(document.activeElement).toBe(inputs[0]);
            expect([inputs[0].selectionStart, inputs[0].selectionEnd]).toEqual([0, inputs[0].value.length]);
            act(() => inputs[1].focus());
            expect([inputs[1].selectionStart, inputs[1].selectionEnd]).toEqual([0, inputs[1].value.length]);
            const setValue = (input: HTMLInputElement, value: string) =>
                act(() => {
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
            const nudge = (input: HTMLInputElement, key: string) =>
                act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
            nudge(inputs[0], 'ArrowDown');
            expect(inputs[0].value).toBe('0:59');
            nudge(inputs[0], 'ArrowUp');
            expect(inputs[0].value).toBe('1:00');
            setValue(inputs[0], '0:00');
            nudge(inputs[0], 'ArrowDown');
            expect(inputs[0].value).toBe('0:00');
            setValue(inputs[0], '1:10');
            nudge(inputs[0], 'ArrowUp');
            expect(inputs[0].value).toBe('1:10');
            expect(inputs[1].value).toBe('374.0');
            setValue(inputs[1], '365');
            nudge(inputs[1], 'ArrowUp');
            expect(inputs[1].value).toBe('365.1');
            nudge(inputs[1], 'ArrowDown');
            expect(inputs[1].value).toBe('365.0');
            expect(inputs[0].value).toBe('1:05');
            act(() =>
                container
                    .querySelector('form')
                    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
            );
            expect(onEditEntry).toHaveBeenCalledWith('fc', { timeSec: 65, tempC: 185 });
            expect(container.querySelector('form')).toBeNull();
            expect(document.activeElement).toBe(buttons[0]);
            act(() => buttons[0].click());
            setValue(container.querySelectorAll('input')[1], '999');
            expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
            act(() =>
                container
                    .querySelector('input')
                    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
            );
            expect(container.querySelector('form')).toBeNull();
            expect(onEditEntry).toHaveBeenCalledTimes(1);
            expect(document.activeElement).toBe(buttons[0]);
        },
    );
});
