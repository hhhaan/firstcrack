// @vitest-environment jsdom
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
}));

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.mocked(settingsGet).mockReset().mockResolvedValue(undefined);
    vi.mocked(settingsSet).mockReset().mockResolvedValue(undefined);
});

it('migrates a legacy cached mute and TP preference into roast.settings and restores both after restart', async () => {
    localStorage.setItem('fc_roast_settings', JSON.stringify({ alertSoundEnabled: false, alertTpEnabled: true }));
    const settings = await import('./settings');
    await vi.waitFor(() => expect(settingsSet).toHaveBeenCalled());
    expect(settingsGet).toHaveBeenCalledWith('roast.settings');
    expect(settings.getRoastSettings()).toMatchObject({ alertSoundEnabled: false, alertTpEnabled: true });
    expect(localStorage.getItem('fc_roast_settings')).toBeNull();
    expect(settingsSet).toHaveBeenCalledWith(
        'roast.settings',
        expect.objectContaining({ alertSoundEnabled: false, alertTpEnabled: true }),
    );
    const persisted = structuredClone(vi.mocked(settingsSet).mock.lastCall?.[1]);
    vi.resetModules();
    vi.mocked(settingsGet).mockResolvedValueOnce(persisted);
    const restarted = await import('./settings');
    expect(restarted.getRoastSettings()).toMatchObject({ alertSoundEnabled: false, alertTpEnabled: true });
});

it('does not let an outdated legacy cache override the stored global mute and TP preference', async () => {
    localStorage.setItem('fc_roast_settings', JSON.stringify({ alertSoundEnabled: true, alertTpEnabled: true }));
    vi.mocked(settingsGet).mockResolvedValueOnce({ alertSoundEnabled: false, alertTpEnabled: false });
    const settings = await import('./settings');
    expect(settings.getRoastSettings()).toMatchObject({ alertSoundEnabled: false, alertTpEnabled: false });
    expect(settingsSet).not.toHaveBeenCalled();
});
