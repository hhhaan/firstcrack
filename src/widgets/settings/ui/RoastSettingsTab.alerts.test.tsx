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

it('persists the TP switch independently and keeps its preference while all alarm sound is muted', async () => {
    const previous = getRoastSettings();
    updateRoastSettings({ alertsEnabled: true, alertSoundEnabled: true, alertTpEnabled: false });
    const host = document.createElement('div');
    const root = createRoot(host);
    const toggle = (key: string) => {
        const label = [...host.querySelectorAll('label')].find((row) =>
            row.textContent?.startsWith(`settings.tabs.roast.${key}settings.tabs.roast.${key}Description`),
        );
        const input = label?.querySelector<HTMLInputElement>('input[role="switch"]');
        if (!input) throw new Error(`Missing ${key} switch`);
        return input;
    };
    try {
        await act(async () => root.render(createElement(RoastSettingsTab)));
        expect(toggle('alertTp').checked).toBe(false);
        act(() => toggle('alertTp').click());
        expect(getRoastSettings()).toMatchObject({ alertTpEnabled: true, alertSoundEnabled: true });
        act(() => toggle('alertSound').click());
        expect(getRoastSettings()).toMatchObject({ alertTpEnabled: true, alertSoundEnabled: false });
        expect(toggle('alertTp').checked).toBe(true);
        act(() => toggle('alertTp').click());
        expect(getRoastSettings()).toMatchObject({ alertTpEnabled: false, alertSoundEnabled: false });
        expect(settingsSet).toHaveBeenLastCalledWith(
            'roast.settings',
            expect.objectContaining({ alertTpEnabled: false, alertSoundEnabled: false }),
            { debounce: true },
        );
    } finally {
        act(() => root.unmount());
        updateRoastSettings(previous);
    }
});
