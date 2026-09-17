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
