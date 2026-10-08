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
});
