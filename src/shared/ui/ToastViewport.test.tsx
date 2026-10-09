// @vitest-environment jsdom

import { useToastStore } from '@shared/store/toast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastViewport } from './ToastViewport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

/** Matches active-roast / history modal shells (RoastSummaryModal, etc.). */
const MODAL_OVERLAY_Z_CLASS = 'z-[10000]';

describe('ToastViewport', () => {
    let host: HTMLDivElement | undefined;

    afterEach(() => {
        for (const toast of useToastStore.getState().toasts) {
            useToastStore.getState().dismiss(toast.id);
        }
        host?.remove();
        host = undefined;
    });

    it('renders above modal overlay z-index and keeps pointer-events-none on the container', async () => {
        useToastStore.getState().show('discharge ok', 'success');
        host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(createElement(ToastViewport));
        });

        const viewport = host.querySelector(':scope > div');
        expect(viewport?.className).toContain('z-[10051]');
        expect(viewport?.className).toContain('pointer-events-none');
        expect(viewport?.className).not.toContain(MODAL_OVERLAY_Z_CLASS);
    });
});
