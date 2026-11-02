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
    updateRoastSettings({ batchTitleSource: 'bean', batchTitleNumbering: 'none', totalBatchPrefix: 'PR' });
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(RoastSettingsTab)));
        const sources = host.querySelectorAll<HTMLInputElement>('input[name="batchTitleSource"]');
        expect(sources).toHaveLength(2);
        expect(sources[1].checked).toBe(true);
        act(() => sources[0].click());
        expect(getRoastSettings()).toMatchObject({ batchTitleSource: 'profile', batchTitleNumbering: 'none' });
        expect(sources[0].checked).toBe(true);
        expect(settingsSet).toHaveBeenCalledWith(
            'roast.settings',
            expect.objectContaining({ batchTitleSource: 'profile', batchTitleNumbering: 'none' }),
            { debounce: true },
        );
        act(() => sources[1].click());
        expect(getRoastSettings()).toMatchObject({ batchTitleSource: 'bean', batchTitleNumbering: 'none' });
        const numbering = host.querySelectorAll<HTMLInputElement>('input[name="batchTitleNumbering"]');
        expect(numbering).toHaveLength(3);
        expect(numbering[2].checked).toBe(true);
        act(() => numbering[1].click());
        expect(getRoastSettings()).toMatchObject({ batchTitleSource: 'bean', batchTitleNumbering: 'total' });
        expect(host.querySelector('input[name="totalBatchPrefix"]')).toBeNull();
        expect(getRoastSettings().totalBatchPrefix).toBe('PR');
    } finally {
        act(() => root.unmount());
        updateRoastSettings({
            batchTitleSource: previous.batchTitleSource,
            batchTitleNumbering: previous.batchTitleNumbering,
            totalBatchPrefix: previous.totalBatchPrefix,
        });
    }
});

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
