// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordEventsEditor } from './RecordEventsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const events = [
    { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
    { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 196 },
    { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210 },
];

let host: HTMLDivElement;
let root: Root;

const mount = async (props: Partial<Parameters<typeof RecordEventsEditor>[0]>) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onClose = vi.fn();
    await act(async () =>
        root.render(
            createElement(RecordEventsEditor, {
                events,
                unit: 'C',
                onSave: vi.fn().mockResolvedValue(undefined),
                errorText: () => 'failed',
                onClose,
                ...props,
            }),
        ),
    );
    return onClose;
};

const type = async (label: string, value: string) => {
    const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
});

describe('RecordEventsEditor', () => {
    it('keeps Charge time read-only', async () => {
        await mount({});
        expect((host.querySelector('input[aria-label="Charge history.edit.time"]') as HTMLInputElement).readOnly).toBe(
            true,
        );
    });

    it('blocks an order inversion without saving', async () => {
        const onSave = vi.fn();
        await mount({ onSave });
        await type('FC Start history.edit.time', '10:30');
        await act(async () => button('history.edit.save')?.click());
        expect(onSave).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('history.edit.invalidOrder');
    });

    it('cancel closes without saving', async () => {
        const onSave = vi.fn();
        const onClose = await mount({ onSave });
        await type('Drop history.edit.temp', '215');
        await act(async () => button('common.cancel')?.click());
        expect(onSave).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('locks while saving, keeps the draft on failure, and ignores a second submit', async () => {
        let reject: (e: unknown) => void = () => {};
        const onSave = vi.fn(
            () =>
                new Promise<void>((_, r) => {
                    reject = r;
                }),
        );
        const onClose = await mount({ onSave, errorText: () => 'conflict' });
        await type('Drop history.edit.temp', '215');
        const form = host.querySelector('form') as HTMLFormElement;
        await act(async () => {
            form.requestSubmit();
            form.requestSubmit();
        });
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(host.querySelector('fieldset')?.disabled).toBe(true);
        expect(button('history.edit.saving')?.disabled).toBe(true);

        await act(async () => reject({ code: 'PT409' }));
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('conflict');
        expect((host.querySelector('input[aria-label="Drop history.edit.temp"]') as HTMLInputElement).value).toBe(
            '215',
        );
        expect(host.querySelector('fieldset')?.disabled).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('saves the patched array and closes', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const onClose = await mount({ onSave });
        await type('FC Start history.edit.time', '7:55');
        await act(async () => button('history.edit.save')?.click());
        expect(onSave).toHaveBeenCalledWith([
            events[0],
            { id: 'f', type: 'FC Start', time_sec: 475, temp_c: 196 },
            events[2],
        ]);
        expect(onClose).toHaveBeenCalled();
    });
    it.each([
        ['FC Start history.edit.time', '8:0a', '8:00'],
        ['FC Start history.edit.time', '8:61', '8:00'],
        ['FC Start history.edit.time', '7:5', '7:5'],
        ['Drop history.edit.temp', '21a', '210'],
        ['Drop history.edit.temp', '-5', '210'],
        ['Drop history.edit.temp', '210.55', '210'],
        ['Drop history.edit.temp', '210.5', '210.5'],
    ])('limits %s input: %s → %s', async (label, typed, expected) => {
        await mount({});
        await type(label, typed);
        expect((host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).value).toBe(expected);
    });
});
