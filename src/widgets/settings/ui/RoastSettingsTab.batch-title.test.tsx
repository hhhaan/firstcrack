// @vitest-environment jsdom
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { settingsSet } from '@shared/lib/settings-store';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoastSettingsTab } from './RoastSettingsTab';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@shared/lib/features', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/lib/features')>()),
    useFeature: () => true,
}));
vi.mock('./RoastingSettingsImport', () => ({ RoastingSettingsImport: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('selects profile or bean names independently of the title numbering', async () => {
    const previous = getRoastSettings();
    updateRoastSettings({ batchTitleSource: 'bean', batchTitleNumbering: 'both' });
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(RoastSettingsTab)));
        const sources = host.querySelectorAll<HTMLInputElement>('input[name="batchTitleSource"]');
        expect(sources).toHaveLength(2);
        expect(sources[1].checked).toBe(true);
        act(() => sources[0].click());
        expect(getRoastSettings()).toMatchObject({ batchTitleSource: 'profile', batchTitleNumbering: 'both' });
        expect(sources[0].checked).toBe(true);
        expect(settingsSet).toHaveBeenCalledWith(
            'roast.settings',
            expect.objectContaining({ batchTitleSource: 'profile', batchTitleNumbering: 'both' }),
            { debounce: true },
        );
        act(() => sources[1].click());
        expect(getRoastSettings()).toMatchObject({ batchTitleSource: 'bean', batchTitleNumbering: 'both' });
        expect(host.querySelectorAll('input[name="batchTitleNumbering"]')).toHaveLength(0);
    } finally {
        act(() => root.unmount());
        updateRoastSettings({
            batchTitleSource: previous.batchTitleSource,
            batchTitleNumbering: previous.batchTitleNumbering,
        });
    }
});
