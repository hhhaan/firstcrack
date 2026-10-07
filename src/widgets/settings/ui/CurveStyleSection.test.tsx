// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { CurveStyleSection } from './CurveStyleSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const label = (channelKey: string, partKey: string) =>
    `settings.tabs.roast.${channelKey} settings.tabs.roast.${partKey}`;

describe('CurveStyleSection', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('edits only the current curve, because the target inherits it', () => {
        act(() => root.render(createElement(CurveStyleSection)));

        expect(container.textContent).not.toContain('curveStyleBackgroundWidth');
        expect(container.textContent).not.toContain('curveStyleBackgroundLine');
        const line = container.querySelector<HTMLButtonElement>(
            `[aria-label="${label('curveStyleChannelEtRor', 'curveStyleCurrentLine')}"]`,
        );
        const heatLine = container.querySelector<HTMLButtonElement>(
            `[aria-label="${label('controlHeat', 'curveStyleCurrentLine')}"]`,
        );
        const width = container.querySelector<HTMLInputElement>(
            `[aria-label="${label('curveStyleChannelEtRor', 'curveStyleCurrentWidth')}"]`,
        );
        expect(line?.disabled).toBe(false);
        expect(heatLine?.disabled).toBe(false);
        expect(heatLine?.textContent).toContain('curveLineType.solid');
        expect(width?.disabled).toBe(false);
        expect(width?.value).toBe('1.8');

        const headerRows = container.querySelectorAll('thead tr');
        expect(headerRows).toHaveLength(1);
        for (const cell of container.querySelectorAll('thead th')) {
            expect(cell.className).toContain('whitespace-nowrap');
        }
        expect(container.querySelector('thead')?.textContent).toContain('settings.tabs.roast.curveStyleWidth');
        expect(container.querySelector('thead')?.textContent).not.toContain('settings.tabs.roast.curveStyleBackground');
    });
});
