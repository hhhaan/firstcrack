// @vitest-environment jsdom
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DisplayStyleSections } from './DisplaySettingsSections';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    updateRoastSettings({ eventMarkerStyle: 'line' });
});

it('selects the line event marker radio when line is the stored default', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    updateRoastSettings({ eventMarkerStyle: 'line' });
    try {
        await act(async () => root.render(createElement(DisplayStyleSections)));
        const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="eventMarkerStyle"]')];
        expect(radios).toHaveLength(3);
        expect(radios[2]?.checked).toBe(true);
        expect(getRoastSettings().eventMarkerStyle).toBe('line');
    } finally {
        act(() => root.unmount());
    }
});
