import type { RoastSettings } from '../model/settings';
import type { ControlData } from './chart-option';

/** Display settings only: saved measurements and events are never reprocessed. */
export const savedChartPresentation = (settings: RoastSettings) => ({
    temperatureUnit: settings.temperatureUnit,
    eventMarkerStyle: settings.eventMarkerStyle,
    tempMinC: settings.tempMinC,
    tempMaxC: settings.tempMaxC,
    rorYMin: settings.rorYMin,
    rorYMax: settings.rorYMax,
    showET: settings.showET,
    showRoR: settings.showRoRChart,
    showRoRET: settings.showRoRET,
    showControlDrum: settings.showControlDrum,
    showControlHeat: settings.showControlHeat,
    showControlFan: settings.showControlFan,
    controlChartHeightPct: settings.controlChartHeightPct,
    mergeControlChart: settings.mergeControlChart,
    controlYMin: settings.controlYMin,
    controlYMax: settings.controlYMax,
    showFcBand: settings.showFcBand,
});

export type SavedSensorPoint = { bt?: number | null; et?: number | null; ror?: number | null; rorEt?: number | null };

export const savedSensorChannels = (points: readonly SavedSensorPoint[], settings: RoastSettings) =>
    [
        { key: 'bt' as const, label: `BT · °${settings.temperatureUnit}`, visible: points.some((p) => p.bt != null) },
        {
            key: 'et' as const,
            label: `ET · °${settings.temperatureUnit}`,
            visible: settings.showET && points.some((p) => p.et != null),
        },
        {
            key: 'ror' as const,
            label: `RoR · °${settings.temperatureUnit}/min`,
            visible: settings.showRoRChart && points.some((p) => p.ror != null),
        },
        {
            key: 'etRor' as const,
            label: `ET RoR · °${settings.temperatureUnit}/min`,
            visible: settings.showRoRET && points.some((p) => p.rorEt != null),
        },
    ].filter((channel) => channel.visible);

/** Do not reserve a control plot when every populated channel is hidden. */
export const savedControlsVisible = (
    data: ControlData | undefined,
    settings: RoastSettings,
    showTarget: boolean,
): boolean => {
    if (!settings.showControlChart || !data) return false;
    const present = (values: readonly (number | null)[] | undefined) =>
        values?.some((value) => value != null && Number.isFinite(value));
    const command = (role: 'heater' | 'fan' | 'drum') =>
        data.changes?.some((change) => {
            const value = change.values[role];
            return value != null && Number.isFinite(value);
        });
    return Boolean(
        (settings.showControlHeat && (present(data.heatPower) || present(data.heatSet) || command('heater'))) ||
            (settings.showControlFan && (present(data.fanSpeed) || command('fan'))) ||
            (settings.showControlDrum && (present(data.drumTemp) || command('drum'))) ||
            (showTarget &&
                ((settings.showProfileHeat && present(data.reference?.heater)) ||
                    (settings.showProfileFan && present(data.reference?.fan)) ||
                    (settings.showProfileDrum && present(data.reference?.drum)))),
    );
};
