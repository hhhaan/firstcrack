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
    const input = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text);

afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
});

describe('RecordEventsEditor', () => {
    it('keeps Charge time read-only', async () => {
        await mount({});
        expect(
            (document.querySelector('input[aria-label="Charge history.edit.time"]') as HTMLInputElement).readOnly,
        ).toBe(true);
    });

    it('blocks an order inversion without saving', async () => {
        const onSave = vi.fn();
        await mount({ onSave });
        await type('FC Start history.edit.time', '10:30');
        await act(async () => button('history.edit.save')?.click());
        expect(onSave).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('history.edit.invalidOrder');
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
        const form = document.querySelector('form') as HTMLFormElement;
        await act(async () => {
            form.requestSubmit();
            form.requestSubmit();
        });
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(document.querySelector('fieldset')?.disabled).toBe(true);
        expect(button('history.edit.saving')?.disabled).toBe(true);

        await act(async () => reject({ code: 'PT409' }));
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('conflict');
        expect((document.querySelector('input[aria-label="Drop history.edit.temp"]') as HTMLInputElement).value).toBe(
            '215',
        );
        expect(document.querySelector('fieldset')?.disabled).toBe(false);
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

    it('ignores Escape while saving and closes on Escape after the save settles', async () => {
        let rejectSave: (error: unknown) => void = () => {};
        const onSave = vi.fn(
            () =>
                new Promise<void>((_, reject) => {
                    rejectSave = reject;
                }),
        );
        const onClose = await mount({ onSave, errorText: () => 'conflict' });
        await type('Drop history.edit.temp', '215');
        const form = document.querySelector('form') as HTMLFormElement;
        const pressEscape = () =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await act(async () => {
            form.requestSubmit();
        });
        await act(async () => {
            pressEscape();
        });
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="record-events-editor"]')).not.toBeNull();

        await act(async () => {
            rejectSave(new Error('nope'));
        });
        expect(onClose).not.toHaveBeenCalled();
        expect(document.querySelector('fieldset')?.disabled).toBe(false);

        await act(async () => {
            pressEscape();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
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
        expect((document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).value).toBe(expected);
    });

    const addButton = () => document.querySelector('[data-testid="record-events-add"]') as HTMLButtonElement;

    const pickType = async (from: string, value: string) => {
        const select = document.querySelector(
            `select[aria-label="${from} history.edit.eventType"]`,
        ) as HTMLSelectElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
    };

    it('adds a missing FC Start and leaves existing rows in place', async () => {
        const source = [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'n', type: 'Note', time_sec: 30, note: 'keep' },
            { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210 },
        ];
        const onSave = vi.fn().mockResolvedValue(undefined);
        const onClose = await mount({ events: source, onSave });
        await act(async () => addButton().click());
        expect((document.querySelector('select') as HTMLSelectElement).value).toBe('FC Start');
        const options = [...document.querySelectorAll('select option')].map((o) => (o as HTMLOptionElement).value);
        expect(options).toEqual(['TP', 'Yellow', 'FC Start', 'FC Rolling', 'FC End']);
        await type('FC Start history.edit.time', '8:00');
        await type('FC Start history.edit.temp', '196');
        await act(async () => button('history.edit.save')?.click());
        const saved = onSave.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(saved[0]).toEqual(source[0]);
        expect(saved[1]).toEqual(source[1]);
        expect(saved[2]).toMatchObject({ type: 'FC Start', time_sec: 480, temp_c: 196 });
        expect(saved[3]).toEqual(source[2]);
        expect(saved[2].id).not.toBe(source[0].id);
        expect(onClose).toHaveBeenCalled();
    });

    it('offers each missing singleton once', async () => {
        await mount({});
        await act(async () => addButton().click());
        await act(async () => addButton().click());
        const selects = [...document.querySelectorAll('select')] as HTMLSelectElement[];
        expect(selects.map((s) => s.value)).toEqual(['Yellow', 'FC Rolling']);
        for (const select of selects) {
            const values = [...select.options].map((o) => o.value);
            expect(values).not.toContain('FC Start');
            expect(values).not.toContain('Charge');
            expect(values).not.toContain('Drop');
            expect(values).not.toContain('End');
        }
        expect(addButton()).not.toBeNull();
    });

    it('hides add when every singleton mark is already present', async () => {
        await mount({
            events: [
                { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
                { id: 'tp', type: 'TP', time_sec: 60, temp_c: 150 },
                { id: 'y', type: 'Yellow', time_sec: 180, temp_c: 160 },
                { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 196 },
                { id: 'fr', type: 'FC Rolling', time_sec: 500, temp_c: 198 },
                { id: 'fe', type: 'FC End', time_sec: 540, temp_c: 202 },
                { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210 },
            ],
        });
        expect(addButton()).toBeNull();
    });

    it('cancel after adding does not save', async () => {
        const onSave = vi.fn();
        const onClose = await mount({ onSave });
        await act(async () => addButton().click());
        await type('Yellow history.edit.time', '4:00');
        await act(async () => button('common.cancel')?.click());
        expect(onSave).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps a new row when save fails', async () => {
        const onSave = vi.fn().mockRejectedValue(new Error('nope'));
        const onClose = await mount({ onSave, errorText: () => 'failed' });
        await act(async () => addButton().click());
        await pickType('Yellow', 'FC End');
        await type('FC End history.edit.time', '9:00');
        await type('FC End history.edit.temp', '202');
        await act(async () => button('history.edit.save')?.click());
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('failed');
        expect((document.querySelector('input[aria-label="FC End history.edit.time"]') as HTMLInputElement).value).toBe(
            '9:00',
        );
        expect(onClose).not.toHaveBeenCalled();
    });

    it('blocks an added mark that falls after Drop', async () => {
        const onSave = vi.fn();
        await mount({
            events: [
                { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
                { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210 },
            ],
            onSave,
        });
        await act(async () => addButton().click());
        await type('FC Start history.edit.time', '11:00');
        await type('FC Start history.edit.temp', '196');
        await act(async () => button('history.edit.save')?.click());
        expect(onSave).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('history.edit.invalidOrder');
    });
});
