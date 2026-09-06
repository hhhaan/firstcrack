// @vitest-environment jsdom
import { Modal } from '@shared/ui/modal-shell/Modal';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

function render(ui: ReactElement) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
        root?.render(ui);
    });
    return host;
}

afterEach(() => {
    act(() => {
        root?.unmount();
    });
    host?.remove();
    root = undefined;
    host = undefined;
});

describe('Modal', () => {
    it('connects dialog aria-labelledby to the title id', () => {
        render(
            <Modal.Root open onClose={() => undefined} labelledBy="dispatch-title">
                <Modal.Header title="Dispatch" />
            </Modal.Root>,
        );

        const dialog = document.querySelector('[role="dialog"]');
        const title = document.getElementById('dispatch-title');
        expect(dialog?.getAttribute('aria-labelledby')).toBe('dispatch-title');
        expect(title?.textContent).toBe('Dispatch');
    });

    it('does not render when closed', () => {
        render(
            <Modal.Root open={false} onClose={() => undefined}>
                <Modal.Header title="Hidden" />
            </Modal.Root>,
        );
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('calls onClose from the header close button', () => {
        const onClose = vi.fn();
        render(
            <Modal.Root open onClose={onClose} labelledBy="close-title">
                <Modal.Header title="Close me" closeLabel="Close" />
            </Modal.Root>,
        );

        const close = document.querySelector('button[aria-label="Close"]');
        act(() => {
            close?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
