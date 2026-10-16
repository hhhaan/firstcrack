// @vitest-environment jsdom
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompleteBatchModal } from './CompleteBatchModal';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const batch = {
    id: 'pb-1',
    bean_id: 'bean-1',
    blend_id: null,
    bean_name: 'Ethiopia',
    batch_size_kg: 5,
    batch_count: 2,
    completed_sessions: 1,
} as PlanBatchWithProgress;

const confirmButton = () =>
    [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent === 'schedule.completeBatch.confirm',
    ) as HTMLButtonElement;

describe('CompleteBatchModal confirm lock', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    const renderModal = (open: boolean, onConfirm: (deductStock: boolean) => void) => {
        act(() => {
            root.render(
                createElement(CompleteBatchModal, {
                    open,
                    batch,
                    onClose: () => undefined,
                    onConfirm,
                }),
            );
        });
    };

    it('ignores a second confirm before the button repaints', () => {
        const onConfirm = vi.fn();
        renderModal(true, onConfirm);
        const button = confirmButton();

        act(() => {
            button.click();
            button.click();
        });

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(button.disabled).toBe(true);
    });

    it('accepts confirm again after the modal opens again', () => {
        const onConfirm = vi.fn();
        renderModal(true, onConfirm);
        act(() => confirmButton().click());

        renderModal(false, onConfirm);
        renderModal(true, onConfirm);
        act(() => confirmButton().click());

        expect(onConfirm).toHaveBeenCalledTimes(2);
    });
});
