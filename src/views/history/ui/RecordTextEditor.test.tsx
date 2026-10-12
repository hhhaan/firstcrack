// @vitest-environment jsdom
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordTextEditor } from './RecordTextEditor';

const state = vi.hoisted(() => ({ update: vi.fn(), ready: true }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: state.ready }),
}));
vi.mock('@entities/roast', () => ({ useUpdateRoastSession: () => ({ mutateAsync: state.update, isPending: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('record text edits', () => {
    let host: HTMLDivElement;
    let root: Root;
    const session = {
        id: 'session',
        user_id: 'owner',
        bean_id: 'bean',
        bean_label: null,
        notes: 'original',
        beans: { name: 'Lot A' },
    } as RoastSessionWithRelations;
    beforeEach(() => {
        state.ready = true;
        state.update.mockReset().mockResolvedValue({});
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });
    const click = async (selector: string) => {
        await act(async () => {
            (host.querySelector(selector) as HTMLButtonElement).click();
        });
    };
    const render = async (value = session) => {
        await act(async () => root.render(createElement(RecordTextEditor, { session: value })));
    };
    const set = async (selector: string, value: string) => {
        const element = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
        const proto =
            element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        await act(async () => {
            Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    it('writes title/notes only while preserving the inventory bean link', async () => {
        await render();
        await click('[data-testid="history-edit-text"]');
        await set('input', '  Batch one  ');
        await set('textarea', ' new notes ');
        await click('[data-testid="history-text-save"]');
        expect(state.update).toHaveBeenCalledWith({ id: 'session', bean_label: 'Batch one', notes: 'new notes' });
        expect(state.update.mock.calls[0][0]).not.toHaveProperty('bean_id');
        expect(host.querySelector('textarea')).toBeNull();
    });
    it('clears an override and reports failure without losing edited text', async () => {
        state.update.mockRejectedValueOnce(new Error('offline'));
        await render();
        await click('[data-testid="history-edit-text"]');
        await set('input', '');
        await set('textarea', 'keep this');
        await click('[data-testid="history-text-save"]');
        expect(state.update).toHaveBeenCalledWith({ id: 'session', bean_label: null, notes: 'keep this' });
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep this');
        await click('[data-testid="history-text-save"]');
        expect(host.querySelector('textarea')).toBeNull();
    });
    it('does not allow writes for a different owner or an unready workspace', async () => {
        await render({ ...session, user_id: 'other' });
        await click('[data-testid="history-edit-text"]');
        expect(host.querySelector('input')).toBeNull();
        state.ready = false;
        await render();
        await click('[data-testid="history-edit-text"]');
        expect(state.update).not.toHaveBeenCalled();
    });
    it('cancel drops the draft without a write', async () => {
        await render();
        await click('[data-testid="history-edit-text"]');
        await set('textarea', 'draft');
        const cancel = [...host.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
        await act(async () => cancel?.click());
        await click('[data-testid="history-edit-text"]');
        expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('original');
        expect(state.update).not.toHaveBeenCalled();
    });
});
