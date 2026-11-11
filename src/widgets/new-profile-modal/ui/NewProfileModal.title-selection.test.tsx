// @vitest-environment jsdom

import { useAuthStore } from '@shared/store/auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProfileModal } from './NewProfileModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fromMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock('@shared/lib/r2', () => ({
    fetchTsvFromR2: vi.fn(),
}));

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: async (_key: string, fallback: unknown) => fallback,
    settingsSet: async () => undefined,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

function mockTables() {
    fromMock.mockImplementation(() => {
        const terminal = Promise.resolve({ data: [], error: null });
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        for (const key of ['select', 'eq', 'order', 'gte', 'lt', 'lte', 'in']) chain[key] = vi.fn(self);
        chain.range = vi.fn(self);
        Object.assign(chain, {
            // biome-ignore lint/suspicious/noThenProperty: supabase query builder is thenable
            then: terminal.then.bind(terminal),
            catch: terminal.catch.bind(terminal),
        });
        return chain;
    });
}

const pointer = (type: 'pointerdown' | 'pointerup') =>
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' });

/**
 * Chromium dispatches `click` on the common ancestor when the press and the release
 * land on different nodes. A title selection that starts in the input and ends on the
 * backdrop therefore clicks the overlay. `detail` is 1 for that real pointer click.
 */
const clickBackdrop = (overlay: Element, detail: number) => {
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail }));
};

const setNativeValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('profile title selection edit', () => {
    let qc: QueryClient;
    let host: HTMLDivElement;
    let root: Root;
    const onClose = vi.fn();
    const onUpdated = vi.fn();

    const flush = async () => {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    };

    const renderModal = async (profileName: string | null) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <NewProfileModal
                        open={profileName !== null}
                        editingProfile={
                            profileName === null
                                ? null
                                : ({
                                      id: 'p1',
                                      name: profileName,
                                      description: '',
                                      target_level: 'Medium',
                                      source_session_id: null,
                                      source_session: null,
                                      default_bean_id: null,
                                      default_blend_id: null,
                                  } as never)
                        }
                        onClose={onClose}
                        onCreated={() => {}}
                        onUpdated={onUpdated}
                    />
                </QueryClientProvider>,
            );
        });
        await flush();
    };

    const nameInput = () =>
        document.querySelector(
            'input[placeholder="newProfileModal.profileNamePlaceholder"]',
        ) as HTMLInputElement | null;

    const backdrop = () => document.querySelector('[role="presentation"]') as HTMLElement;
    const dialog = () => document.querySelector('[role="dialog"]');

    beforeEach(() => {
        onClose.mockReset();
        onUpdated.mockReset();
        fromMock.mockReset();
        mockTables();
        useAuthStore.setState({ user: { id: 'owner-1' } as never, loading: false });
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        qc.clear();
        useAuthStore.setState({ user: null, loading: true });
    });

    it('keeps the editor open when a title drag ends on the backdrop and Backspace replaces the selection', async () => {
        await renderModal('Light Floral');
        const input = nameInput();
        if (!input) throw new Error('profile title input missing');
        input.focus();
        input.setSelectionRange(0, input.value.length);

        const overlay = backdrop();
        await act(async () => {
            input.dispatchEvent(pointer('pointerdown'));
            overlay.dispatchEvent(pointer('pointerup'));
            clickBackdrop(overlay, 1);
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(dialog()).not.toBeNull();
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe('Light Floral'.length);

        const backspace = new KeyboardEvent('keydown', {
            key: 'Backspace',
            code: 'Backspace',
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            input.dispatchEvent(backspace);
        });
        expect(backspace.defaultPrevented).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        // jsdom does not apply the editing default action. The key must not be cancelled first.
        await act(async () => setNativeValue(input, ''));

        expect(dialog()).not.toBeNull();
        expect(input.value).toBe('');
        expect(input.isConnected).toBe(true);

        await act(async () => setNativeValue(input, 'City Plus'));
        const save = [...document.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('newProfileModal.saveProfile'),
        );
        await act(async () => save?.click());

        expect(onUpdated).toHaveBeenCalledWith({ id: 'p1', name: 'City Plus' });
        expect(onClose).toHaveBeenCalledTimes(1);

        await renderModal(null);
        expect(dialog()).toBeNull();
        await renderModal('City Plus');
        expect(nameInput()?.value).toBe('City Plus');
    });

    it('still closes from a backdrop press, cancel, the header control, and Escape', async () => {
        await renderModal('Light Floral');
        const input = nameInput();
        if (!input) throw new Error('profile title input missing');

        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        const oneChar = new KeyboardEvent('keydown', {
            key: 'Backspace',
            code: 'Backspace',
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            input.dispatchEvent(oneChar);
            setNativeValue(input, 'Light Flora');
        });
        expect(oneChar.defaultPrevented).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        expect(input.value).toBe('Light Flora');

        input.setSelectionRange(0, 'Light '.length);
        const selected = new KeyboardEvent('keydown', {
            key: 'Delete',
            code: 'Delete',
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            input.dispatchEvent(selected);
            setNativeValue(input, 'Flora');
        });
        expect(selected.defaultPrevented).toBe(false);
        expect(dialog()).not.toBeNull();
        expect(input.value).toBe('Flora');

        const overlay = backdrop();
        await act(async () => {
            overlay.dispatchEvent(pointer('pointerdown'));
            overlay.dispatchEvent(pointer('pointerup'));
            clickBackdrop(overlay, 1);
        });
        expect(onClose).toHaveBeenCalledTimes(1);

        onClose.mockClear();
        await act(async () => overlay.click());
        expect(onClose).toHaveBeenCalledTimes(1);

        onClose.mockClear();
        const cancel = [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'newProfileModal.cancel',
        );
        await act(async () => cancel?.click());
        expect(onClose).toHaveBeenCalledTimes(1);

        onClose.mockClear();
        const close = document.querySelector('[aria-label="common.close"]');
        await act(async () => (close as HTMLButtonElement | null)?.click());
        expect(onClose).toHaveBeenCalledTimes(1);

        onClose.mockClear();
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(dialog()).not.toBeNull();
    });
});
