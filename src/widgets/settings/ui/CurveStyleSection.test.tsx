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

    it('keeps background width and line selectable for a channel with no background curve', () => {
        act(() => root.render(createElement(CurveStyleSection)));

        expect(container.textContent).not.toContain('curveStyleNoBackground');
        const line = container.querySelector<HTMLButtonElement>(
            `[aria-label="${label('curveStyleChannelEtRor', 'curveStyleBackgroundLine')}"]`,
        );
        const width = container.querySelector<HTMLInputElement>(
            `[aria-label="${label('curveStyleChannelEtRor', 'curveStyleBackgroundWidth')}"]`,
        );
        expect(line?.disabled).toBe(false);
        expect(width?.disabled).toBe(false);
        expect(width?.value).toBe('1.8');
    });
});
