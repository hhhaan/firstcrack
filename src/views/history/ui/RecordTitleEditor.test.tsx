// @vitest-environment jsdom
import { formatDateTimeShort } from '@shared/lib/format';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordTitleEditor } from './RecordTitleEditor';

const state = vi.hoisted(() => ({ update: vi.fn(), ready: true }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: state.ready }),
}));
vi.mock('@entities/roast', () => ({ useUpdateRoastSession: () => ({ mutateAsync: state.update, isPending: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('record title edits', () => {
    let host: HTMLDivElement;
    let root: Root;
    const session = {
        id: 'session',
        user_id: 'owner',
        bean_id: 'bean',
        bean_label: null,
        roasted_at: '2026-10-09T00:00:00.000Z',
        notes: 'leave me',
        beans: { name: 'Ethiopia · Yirgacheffe · Aricha · Heirloom' },
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
    const render = async (value = session) => {
        await act(async () => root.render(createElement(RecordTitleEditor, { session: value })));
    };
    const control = () =>
        host.querySelector('[data-testid="history-record-title"]') as HTMLInputElement | HTMLButtonElement;
    const open = async () => {
        await act(async () => {
            (control() as HTMLButtonElement).click();
        });
    };
    const set = async (value: string) => {
        const element = control() as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const blur = async () => {
        await act(async () => {
            const element = control() as HTMLInputElement;
            element.focus();
            element.blur();
        });
    };
    it('edits the heading and writes only the session title', async () => {
        await render();
        expect(host.querySelector('h1')?.textContent).toBe('Ethiopia · Yirgacheffe · Aricha · Heirloom');
        await open();
        await set('  Sample lot  ');
        await blur();
        expect(state.update).toHaveBeenCalledWith({ id: 'session', batch_name: 'Sample lot' });
        expect(state.update.mock.calls[0][0]).not.toHaveProperty('notes');
        expect(state.update.mock.calls[0][0]).not.toHaveProperty('bean_id');
    });
    it('stores a title equal to the inventory name instead of clearing it', async () => {
        await render({ ...session, batch_name: 'Sample lot' });
        await open();
        await set('Ethiopia · Yirgacheffe · Aricha · Heirloom');
        await blur();
        expect(state.update).toHaveBeenCalledWith({
            id: 'session',
            batch_name: 'Ethiopia · Yirgacheffe · Aricha · Heirloom',
        });
    });
    it('does not seed a title when the legacy row is committed unchanged', async () => {
        await render();
        await open();
        await blur();
        expect(state.update).not.toHaveBeenCalled();
        expect(host.querySelector('input')).toBeNull();
    });
    it('keeps a date fallback from becoming a stored title', async () => {
        await render({ ...session, beans: null, batch_name: null });
        expect(host.querySelector('h1')?.textContent).toBe(formatDateTimeShort(session.roasted_at));
        await open();
        await blur();
        expect(state.update).not.toHaveBeenCalled();
    });
    it('preserves a legacy free-text name when assigning a new independent batch title', async () => {
        await render({ ...session, bean_label: 'Legacy green label', batch_name: null });
        expect(host.querySelector('h1')?.textContent).toBe('Legacy green label');
        await open();
        await set('Batch C');
        await blur();
        expect(state.update).toHaveBeenCalledWith({ id: 'session', batch_name: 'Batch C' });
        expect(state.update.mock.calls[0][0]).not.toHaveProperty('bean_label');
        expect(state.update.mock.calls[0][0]).not.toHaveProperty('profile_id');
    });
    it('keeps the draft and reports failure', async () => {
        state.update.mockRejectedValueOnce(new Error('offline'));
        await render();
        await open();
        await set('Renamed');
        await blur();
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect((control() as HTMLInputElement).value).toBe('Renamed');
    });
    it('escape drops the draft without a write', async () => {
        await render({ ...session, batch_name: 'Sample lot' });
        await open();
        await set('draft');
        await act(async () => {
            control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(host.querySelector('h1')?.textContent).toBe('Sample lot');
        expect(state.update).not.toHaveBeenCalled();
    });
    it('does not open an editor for a different owner or an unready workspace', async () => {
        await render({ ...session, user_id: 'other' });
        expect(host.querySelector('button')).toBeNull();
        expect(host.querySelector('h1')?.textContent).toBe('Ethiopia · Yirgacheffe · Aricha · Heirloom');
        state.ready = false;
        await render();
        expect(host.querySelector('[data-testid="history-record-title"]')).toBeNull();
    });
});
