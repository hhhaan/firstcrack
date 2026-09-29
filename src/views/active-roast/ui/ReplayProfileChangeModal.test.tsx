// @vitest-environment jsdom
import i18n from 'i18next';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import { ReplayProfileChangeModal } from './ReplayProfileChangeModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mount = async (over: { open?: boolean; onCancel?: () => void; onConfirm?: () => void } = {}) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCancel = over.onCancel ?? vi.fn();
    const onConfirm = over.onConfirm ?? vi.fn();
    await act(async () => {
        root.render(
            createElement(
                I18nextProvider,
                { i18n },
                createElement(ReplayProfileChangeModal, {
                    open: over.open ?? true,
                    onCancel,
                    onConfirm,
                }),
            ),
        );
    });
    return {
        container,
        onCancel,
        onConfirm,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
};

describe('ReplayProfileChangeModal', () => {
    beforeAll(async () => {
        if (!i18n.isInitialized) {
            await i18n.init({
                lng: 'en',
                fallbackLng: 'en',
                resources: { en: { translation: en } },
                interpolation: { escapeValue: false },
            });
        }
    });

    const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;

    it('확인 문구와 버튼을 보여 준다', async () => {
        const { unmount } = await mount();
        expect(dialog().textContent).toContain('Replay is running. Changing the profile will stop Replay.');
        expect(dialog().textContent).toContain('Stop Replay and change');
        expect(dialog().textContent).toContain('Cancel');
        unmount();
    });

    it('취소와 Escape는 Replay를 유지한다', async () => {
        const { onCancel, onConfirm, unmount } = await mount();
        act(() => {
            (dialog().querySelector('button') as HTMLButtonElement).click();
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onCancel).toHaveBeenCalledTimes(2);
        unmount();
    });

    it('확인은 중단 후 변경 경로를 탄다', async () => {
        const { onConfirm, unmount } = await mount();
        act(() => {
            (dialog().querySelector('[data-testid="replay-profile-change-confirm"]') as HTMLButtonElement).click();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('Tab stays inside the modal and closing restores the previous focus', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const { unmount } = await mount();
        const [cancel, confirm] = dialog().querySelectorAll('button');
        expect(document.activeElement).toBe(confirm);
        for (const shiftKey of [false, false, true, true]) {
            const previous = document.activeElement;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
            expect(document.activeElement).toBe(previous === confirm ? cancel : confirm);
        }
        unmount();
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });
});
