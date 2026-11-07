// @vitest-environment jsdom
import { getRoastSettings, sliderToFontScale, updateRoastSettings } from '@features/active-roast/model/settings';
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
vi.mock('@features/machine-control/api/useSidecarStatus', () => ({
    useSidecarStatus: () => ({ data: undefined }),
}));
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

it('turns the TP switch off with alarm sound and keeps the saved preference', async () => {
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
        expect(toggle('alertTp').checked).toBe(false);
        expect(toggle('alertTp').disabled).toBe(true);
        act(() => toggle('alertSound').click());
        expect(toggle('alertTp').checked).toBe(true);
        expect(toggle('alertTp').disabled).toBe(false);
        act(() => toggle('alertTp').click());
        expect(getRoastSettings()).toMatchObject({ alertTpEnabled: false, alertSoundEnabled: true });
        expect(settingsSet).toHaveBeenLastCalledWith(
            'roast.settings',
            expect.objectContaining({ alertTpEnabled: false, alertSoundEnabled: true }),
            { debounce: true },
        );
    } finally {
        act(() => root.unmount());
        updateRoastSettings(previous);
    }
});

it('keeps section groups in order and commits the font slider only after the gesture', async () => {
    const previous = getRoastSettings();
    updateRoastSettings({ fontScalePct: 100 });
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(RoastSettingsTab)));
        expect(
            [...host.querySelectorAll('[data-settings-section]')].map((section) =>
                section.getAttribute('data-settings-group'),
            ),
        ).toEqual([
            'general',
            'alerts',
            'automation',
            'automation',
            'automation',
            'bbp',
            'automation',
            'automation',
            'events',
            'events',
            'display',
            'display',
            'display',
            'display',
            'display',
            'axes',
            'axes',
            'axes',
            'sensors',
            'general',
            'general',
            'sensors',
            'general',
        ]);
        const slider = host.querySelector<HTMLInputElement>('input[name="fontScalePct"]');
        if (!slider) throw new Error('Missing font scale slider');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '75');
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(slider.getAttribute('aria-valuetext')).toBe('75%');
        expect(getRoastSettings().fontScalePct).toBe(100);
        act(() => slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })));
        expect(getRoastSettings().fontScalePct).toBe(sliderToFontScale(75));
        expect(settingsSet).toHaveBeenLastCalledWith(
            'roast.settings',
            expect.objectContaining({ fontScalePct: sliderToFontScale(75) }),
            { debounce: true },
        );
    } finally {
        act(() => root.unmount());
        updateRoastSettings({ fontScalePct: previous.fontScalePct });
    }
});
