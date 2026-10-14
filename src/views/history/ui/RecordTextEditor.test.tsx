// @vitest-environment jsdom
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordTextEditor } from './RecordTextEditor';

const state = vi.hoisted(() => ({ update: vi.fn(), saveEvents: vi.fn(), ready: true, canWrite: true }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: state.ready }),
}));
vi.mock('@entities/roast', () => ({ useUpdateRoastSession: () => ({ mutateAsync: state.update, isPending: false }) }));
vi.mock('../hooks/useRoastRecordSave', () => ({
    useRoastRecordSave: () => ({
        canWrite: state.canWrite,
        isPending: false,
        saveEvents: state.saveEvents,
        saveHeater: vi.fn(),
        errorText: () => 'failed',
    }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('record notes edits', () => {
    let host: HTMLDivElement;
    let root: Root;
    const session = {
        id: 'session',
        user_id: 'owner',
        bean_id: 'bean',
        bean_label: 'Keep this title',
        notes: 'original',
        events: [
            { id: 'c', type: 'Charge', time_sec: 0 },
            { id: 'n', type: 'Note', time_sec: 61, note: 'aroma' },
        ],
        beans: { name: 'Lot A' },
    } as unknown as RoastSessionWithRelations;
    beforeEach(() => {
        state.ready = true;
        state.canWrite = true;
        state.update.mockReset().mockResolvedValue({});
        state.saveEvents.mockReset().mockResolvedValue({});
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });
    const render = async (value = session) => {
        await act(async () => root.render(createElement(RecordTextEditor, { session: value })));
    };
    const notes = () => host.querySelector('textarea') as HTMLTextAreaElement;
    const set = async (value: string) => {
        const element = notes();
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const blur = async () => {
        await act(async () => {
            notes().focus();
            notes().blur();
        });
    };
    it('writes notes only and leaves the session title alone', async () => {
        await render();
        await set(' new notes ');
        await blur();
        expect(state.update).toHaveBeenCalledWith({ id: 'session', notes: 'new notes' });
        expect(state.update.mock.calls[0][0]).not.toHaveProperty('bean_label');
        expect(notes().value).toBe('new notes');
    });
    it('clears notes and keeps the draft when the write fails', async () => {
        await render();
        await set('  ');
        await blur();
        expect(state.update).toHaveBeenCalledWith({ id: 'session', notes: null });
        expect(host.querySelector('[role="alert"]')).toBeNull();
        state.update.mockRejectedValueOnce(new Error('offline'));
        await set('keep this');
        await blur();
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(notes().value).toBe('keep this');
    });
    it('does not write for a different owner or an unready workspace', async () => {
        await render({ ...session, user_id: 'other' });
        expect(notes().readOnly).toBe(true);
        await set('nope');
        await blur();
        state.ready = false;
        await render();
        await set('nope');
        await blur();
        expect(state.update).not.toHaveBeenCalled();
    });
    it('escape drops the draft without a write', async () => {
        await render();
        await set('draft');
        await act(async () => {
            notes().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(notes().value).toBe('original');
        expect(state.update).not.toHaveBeenCalled();
    });
    it('does not write when the note is unchanged', async () => {
        await render();
        await blur();
        expect(state.update).not.toHaveBeenCalled();
    });
    it('shows roast-log notes and writes that event instead of the summary note', async () => {
        await render({ ...session, notes: null });
        expect(host.querySelector('textarea')).toBeNull();
        const field = host.querySelector('[data-testid="history-recorded-note"]') as HTMLInputElement;
        expect(field.value).toBe('aroma');
        expect((host.querySelector('[data-testid="history-recorded-note-time"]') as HTMLInputElement).value).toBe(
            '1:01',
        );
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '  sweeter ');
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            field.focus();
            field.blur();
        });
        expect(state.update).not.toHaveBeenCalled();
        expect(state.saveEvents).toHaveBeenCalledWith([
            { id: 'c', type: 'Charge', time_sec: 0 },
            { id: 'n', type: 'Note', time_sec: 61, note: 'sweeter' },
        ]);
    });
    it('rejects letters in a note time', async () => {
        await render();
        const time = host.querySelector('[data-testid="history-recorded-note-time"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(time, '1a');
            time.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(time.value).toBe('1:01');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(time, '2:05');
            time.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(time.value).toBe('2:05');
    });
    it('adds and deletes a roast-log note', async () => {
        await render({ ...session, notes: null, events: [{ id: 'c', type: 'Charge', time_sec: 0 }] });
        const time = host.querySelector('[data-testid="history-note-add-time"]') as HTMLInputElement;
        const comment = host.querySelector('[data-testid="history-note-add"]') as HTMLInputElement;
        const setInput = async (element: HTMLInputElement, value: string) => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
                element.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        await setInput(time, '1:30');
        await setInput(comment, 'later');
        const add = [...host.querySelectorAll('button')].find(
            (button) => button.getAttribute('aria-label') === 'history.recordText.add',
        );
        await act(async () => add?.click());
        const added = state.saveEvents.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(added[0]).toEqual({ id: 'c', type: 'Charge', time_sec: 0 });
        expect(added[1]).toMatchObject({ type: 'Note', time_sec: 90, note: 'later' });

        state.saveEvents.mockClear();
        await render();
        const remove = host.querySelector('[data-testid="history-note-delete"]') as HTMLButtonElement;
        await act(async () => remove.click());
        expect(state.saveEvents).toHaveBeenCalledWith([{ id: 'c', type: 'Charge', time_sec: 0 }]);
    });
    it('adds at 00:00 when the time field is left on its placeholder', async () => {
        await render({ ...session, notes: null, events: [{ id: 'c', type: 'Charge', time_sec: 0 }] });
        const comment = host.querySelector('[data-testid="history-note-add"]') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(comment, 'later');
        });
        const add = [...host.querySelectorAll('button')].find(
            (button) => button.getAttribute('aria-label') === 'history.recordText.add',
        );
        await act(async () => add?.click());
        const added = state.saveEvents.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(added[1]).toMatchObject({ type: 'Note', time_sec: 0, note: 'later' });
    });
    it('does not save a note while Korean input is still composing', async () => {
        await render();
        const field = host.querySelector('[data-testid="history-recorded-note"]') as HTMLInputElement;
        const add = host.querySelector('[data-testid="history-note-add"]') as HTMLInputElement;
        const enter = () => {
            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
            Object.defineProperty(event, 'isComposing', { value: true });
            return event;
        };
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '향');
            field.dispatchEvent(enter());
        });
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(add, '향');
            add.dispatchEvent(enter());
        });
        expect(state.saveEvents).not.toHaveBeenCalled();
    });
});
