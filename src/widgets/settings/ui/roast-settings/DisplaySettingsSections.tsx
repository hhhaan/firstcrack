import {
    type EventMarkerStyle,
    FONT_SLIDER_MAX,
    FONT_SLIDER_MIN,
    fontScaleToSlider,
    sliderToFontScale,
    updateRoastSettings,
    useRoastSettings,
} from '@features/active-roast';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow, settingsOptionLabelCls } from '../SettingsOptionRow';
import { SettingsSection } from '../SettingsSection';
import { type RoastCheckOption, RoastCheckRows } from './RoastSettingsFields';

const eventMarkerStyleOptions: { value: EventMarkerStyle; labelKey: string; descKey: string }[] = [
    {
        value: 'point',
        labelKey: 'settings.tabs.roast.eventMarkerPoint',
        descKey: 'settings.tabs.roast.eventMarkerPointDescription',
    },
    {
        value: 'callout',
        labelKey: 'settings.tabs.roast.eventMarkerCallout',
        descKey: 'settings.tabs.roast.eventMarkerCalloutDescription',
    },
    {
        value: 'tempLine',
        labelKey: 'settings.tabs.roast.eventMarkerTempLine',
        descKey: 'settings.tabs.roast.eventMarkerTempLineDescription',
    },
    {
        value: 'line',
        labelKey: 'settings.tabs.roast.eventMarkerLine',
        descKey: 'settings.tabs.roast.eventMarkerLineDescription',
    },
];
const visibilityOptions = [
    {
        key: 'showET' as const,
        labelKey: 'settings.tabs.roast.showET',
        descKey: 'settings.tabs.roast.showETDescription',
    },
    {
        key: 'showTargetCurve' as const,
        labelKey: 'settings.tabs.roast.showTargetCurve',
        descKey: 'settings.tabs.roast.showTargetCurveDescription',
    },
    {
        key: 'showTargetDeltaLabel' as const,
        labelKey: 'settings.tabs.roast.showTargetDeltaLabel',
        descKey: 'settings.tabs.roast.showTargetDeltaLabelDescription',
    },
    {
        key: 'showRoRChart' as const,
        labelKey: 'settings.tabs.roast.showRoRChart',
        descKey: 'settings.tabs.roast.showRoRChartDescription',
    },
    {
        key: 'showRoRET' as const,
        labelKey: 'settings.tabs.roast.showRoRET',
        descKey: 'settings.tabs.roast.showRoRETDescription',
    },
    {
        key: 'showControlChart' as const,
        labelKey: 'settings.tabs.roast.showControlChart',
        descKey: 'settings.tabs.roast.showControlChartDescription',
    },
    {
        key: 'showPhaseBar' as const,
        labelKey: 'settings.tabs.roast.showPhaseBar',
        descKey: 'settings.tabs.roast.showPhaseBarDescription',
    },
    {
        key: 'showFcBand' as const,
        labelKey: 'settings.tabs.roast.showFcBand',
        descKey: 'settings.tabs.roast.showFcBandDescription',
    },
];
const profileSeriesOptions: RoastCheckOption[] = (
    [
        ['showProfileBt', 'profileBt'],
        ['showProfileEt', 'profileEt'],
        ['showProfileRor', 'profileRor'],
        ['showProfileEtRor', 'profileEtRor'],
        ['showProfileDrum', 'profileDrum'],
        ['showProfileHeat', 'profileHeat'],
        ['showProfileFan', 'profileFan'],
    ] as const
).map(([key, label]) => ({
    key,
    labelKey: `settings.tabs.roast.${label}`,
    descKey: `settings.tabs.roast.${label}Description`,
}));
export const DisplayVisibilitySections = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);

    return (
        <>
            <SettingsSection group="display">
                <SettingsSection.Header title={tk('dataVisibility')} description={tk('dataVisibilityDescription')} />
                <SettingsSection.Body>
                    <RoastCheckRows options={visibilityOptions} />
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="display">
                <SettingsSection.Header title={tk('profileSeries')} description={tk('profileSeriesDescription')} />
                <SettingsSection.Body>
                    <RoastCheckRows options={profileSeriesOptions} />
                </SettingsSection.Body>
            </SettingsSection>
        </>
    );
};
export const DisplayStyleSections = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const committedFontPct = fontScaleToSlider(roastSettings.fontScalePct);
    const [fontDraft, setFontDraft] = useState<number | null>(null);
    const fontSizePct = fontDraft ?? committedFontPct;
    const commitFontSlider = (slider: number) => {
        setFontDraft(null);
        const next = sliderToFontScale(slider);
        if (next !== roastSettings.fontScalePct) updateRoastSettings({ fontScalePct: next });
    };
    return (
        <>
            <SettingsSection group="display">
                <SettingsSection.Header title={tk('eventMarkers')} description={tk('eventMarkersDescription')} />
                <SettingsSection.Body className="grid gap-4">
                    {eventMarkerStyleOptions.map(({ value, labelKey, descKey }) => (
                        <SettingsCheckRow
                            key={value}
                            type="radio"
                            name="eventMarkerStyle"
                            checked={roastSettings.eventMarkerStyle === value}
                            label={t(labelKey)}
                            description={t(descKey)}
                            onChange={() => updateRoastSettings({ eventMarkerStyle: value })}
                        />
                    ))}
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="display">
                <SettingsSection.Header title={tk('fontScale')} description={tk('fontScaleDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            name="fontScalePct"
                            min={FONT_SLIDER_MIN}
                            max={FONT_SLIDER_MAX}
                            step={1}
                            value={fontSizePct}
                            aria-label={tk('fontScale')}
                            aria-valuetext={`${fontSizePct}%`}
                            className="h-5 w-full accent-palette-black"
                            onChange={(event) => setFontDraft(Number(event.currentTarget.value))}
                            onPointerUp={(event) => commitFontSlider(Number(event.currentTarget.value))}
                            onKeyUp={(event) => commitFontSlider(Number(event.currentTarget.value))}
                        />
                        <span className={`${settingsOptionLabelCls} min-w-10 text-right`}>{fontSizePct}%</span>
                    </div>
                </SettingsSection.Body>
            </SettingsSection>
        </>
    );
};
