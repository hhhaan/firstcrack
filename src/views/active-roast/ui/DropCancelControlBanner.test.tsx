// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropCancelControlBanner } from './DropCancelControlBanner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

describe('DropCancelControlBanner', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        void act(() => root.unmount());
        container.remove();
    });

    it('calls restore only when the user clicks the button', () => {
        const onRestorePid = vi.fn();
        void act(() =>
            root.render(
                createElement(DropCancelControlBanner, {
                    showRestorePid: true,
                    restoreBusy: false,
                    onRestorePid,
                }),
            ),
        );
        expect(onRestorePid).not.toHaveBeenCalled();
        void act(() =>
            (container.querySelector('[data-testid="drop-cancel-restore-pid"]') as HTMLButtonElement).click(),
        );
        expect(onRestorePid).toHaveBeenCalledTimes(1);
    });
});
