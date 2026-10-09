// @vitest-environment jsdom

import { useModalStackStore } from '@shared/store/modalStack';
import { useToastStore } from '@shared/store/toast';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_VIEWPORT_BOTTOM_CLASS, TOAST_VIEWPORT_TOP_CLASS, ToastViewport } from './ToastViewport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

/** Matches active-roast / history modal shells (RoastSummaryModal, etc.). */
const MODAL_OVERLAY_Z_CLASS = 'z-[10000]';

const findToastViewport = () => document.querySelector<HTMLElement>('[data-toast-viewport]');

describe('ToastViewport', () => {
    let host: HTMLDivElement | undefined;
    let root: ReturnType<typeof createRoot> | undefined;

    afterEach(async () => {
        if (root) {
            await act(async () => {
                root?.render(null);
            });
        }
        for (const toast of useToastStore.getState().toasts) {
            useToastStore.getState().dismiss(toast.id);
        }
        useModalStackStore.setState({ openCount: 0 });
        host?.remove();
        host = undefined;
        root = undefined;
        document.body.innerHTML = '';
    });

    const renderViewport = async (withModal = false) => {
        useToastStore.getState().show('discharge ok', 'success');
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                <>
                    {withModal ? (
                        <ModalShell onClose={() => {}} labelledBy="modal-title">
                            <div className="flex min-h-[320px] flex-col">
                                <h2 id="modal-title">Roast Complete</h2>
                                <div className="mt-auto flex justify-end gap-2 p-4" data-testid="modal-footer">
                                    <button type="button">Cancel Drop</button>
                                </div>
                            </div>
                        </ModalShell>
                    ) : null}
                    <ToastViewport />
                </>,
            );
        });
    };

    it('renders above modal overlay z-index and keeps pointer-events-none on the container', async () => {
        await renderViewport(false);
        const viewport = findToastViewport();
        expect(viewport?.className).toContain('z-[10051]');
        expect(viewport?.className).toContain('pointer-events-none');
        expect(viewport?.className).not.toContain(MODAL_OVERLAY_Z_CLASS);
    });

    it('anchors to the bottom when no modal is open', async () => {
        await renderViewport(false);
        const viewport = findToastViewport();
        expect(viewport?.dataset.modalOpen).toBe('false');
        expect(viewport?.className).toContain(TOAST_VIEWPORT_BOTTOM_CLASS);
        expect(viewport?.className).not.toContain(TOAST_VIEWPORT_TOP_CLASS);
    });

    it('anchors to the top while ModalShell is mounted', async () => {
        await renderViewport(true);
        const viewport = findToastViewport();
        expect(viewport?.dataset.modalOpen).toBe('true');
        expect(viewport?.className).toContain(TOAST_VIEWPORT_TOP_CLASS);
        expect(viewport?.className).not.toContain(TOAST_VIEWPORT_BOTTOM_CLASS);
    });

    it('does not use bottom anchoring while a modal is open (footer click-through)', async () => {
        await renderViewport(true);
        const viewport = findToastViewport();
        const footer = document.querySelector('[data-testid="modal-footer"]');
        expect(footer).toBeTruthy();
        expect(viewport?.className).not.toContain(TOAST_VIEWPORT_BOTTOM_CLASS);
        expect(viewport?.className).toContain(TOAST_VIEWPORT_TOP_CLASS);
        // jsdom has no layout; placement is enforced by top vs bottom utility classes.
        expect(viewport?.className).toMatch(/\btop-6\b/);
        expect(viewport?.className).not.toMatch(/\bbottom-6\b/);
    });
});
