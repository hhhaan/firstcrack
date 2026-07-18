import {
    type EventMarkerStyle,
    type PollIntervalMs,
    type RorSpanSec,
    type TemperatureUnit,
    updateRoastSettings,
    useRoastSettings,
} from '@features/active-roast';
import { SectionCard } from '@shared/ui/SectionCard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import {
    SettingsCheckRow,
    SettingsOptionRow,
    settingsOptionDescCls,
    settingsOptionLabelCls,
} from './SettingsOptionRow';

const temperatureOptions: TemperatureUnit[] = ['C', 'F'];
const pollOptions: PollIntervalMs[] = [500, 1000];
const rorOptions: RorSpanSec[] = [15, 30, 60];

const eventMarkerStyleOptions: { value: EventMarkerStyle; labelKey: string; descKey: string }[] = [
    {
        value: 'point',
        labelKey: 'settings.tabs.roast.eventMarkerPoint',
        descKey: 'settings.tabs.roast.eventMarkerPointDescription',
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
];

const controlSeriesOptions = [
    {
        key: 'showControlDrum' as const,
        labelKey: 'settings.tabs.roast.controlDrum',
        descKey: 'settings.tabs.roast.controlDrumDescription',
    },
    {
        key: 'showControlHeat' as const,
        labelKey: 'settings.tabs.roast.controlHeat',
        descKey: 'settings.tabs.roast.controlHeatDescription',
    },
    {
        key: 'showControlFan' as const,
        labelKey: 'settings.tabs.roast.controlFan',
        descKey: 'settings.tabs.roast.controlFanDescription',
    },
];

const numberInputWrapCls =
    'flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#262b31]';

const NumberInput = ({
    value,
    onChange,
    min,
    max,
    suffix,
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    suffix?: string;
}) => {
    const [local, setLocal] = useState(() => String(value));

    useEffect(() => {
        setLocal(String(value));
    }, [value]);

    const clamp = (n: number) => {
        if (min !== undefined && n < min) return min;
        if (max !== undefined && n > max) return max;
        return n;
    };

    return (
        <div className={numberInputWrapCls}>
            <NumericFormat
                value={local}
                valueIsNumericString
                allowNegative
                onValueChange={(values) => {
                    setLocal(values.value);
                    if (values.floatValue !== undefined) {
                        onChange(clamp(values.floatValue));
                    }
                }}
                onBlur={() => {
                    if (local === '') {
                        const fallback = min ?? 0;
                        setLocal(String(fallback));
                        onChange(fallback);
                    }
                }}
                className="w-14 bg-transparent text-[13px] font-medium text-[#111827] dark:text-[#e5e5e5] text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            {suffix && <span className="text-[12px] text-[#6B7280] dark:text-[#999]">{suffix}</span>}
        </div>
    );
};

const RangeRow = ({
    label,
    minVal,
    maxVal,
    onMinChange,
    onMaxChange,
    min,
    max,
    suffix,
}: {
    label: string;
    minVal: number;
    maxVal: number;
    onMinChange: (v: number) => void;
    onMaxChange: (v: number) => void;
    min?: number;
    max?: number;
    suffix?: string;
}) => (
    <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-[#374151] dark:text-[#ccc] shrink-0">{label}</span>
        <div className="flex items-center gap-2">
            <NumberInput value={minVal} onChange={onMinChange} min={min} max={maxVal - 1} suffix={suffix} />
            <span className="text-[12px] text-[#9CA3AF] dark:text-[#666]">–</span>
            <NumberInput value={maxVal} onChange={onMaxChange} min={minVal + 1} max={max} suffix={suffix} />
        </div>
    </div>
);

export const RoastSettingsTab = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);

    return (
        <div className="grid gap-4">
            <SectionCard>
                <SectionCard.Header title={tk('temperatureUnit')} description={tk('temperatureUnitDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    {temperatureOptions.map((u) => (
                        <SettingsCheckRow
                            key={u}
                            checked={roastSettings.temperatureUnit === u}
                            label={`°${u}`}
                            onChange={() => updateRoastSettings({ temperatureUnit: u })}
                        />
                    ))}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('updateRate')} description={tk('updateRateDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    {pollOptions.map((ms) => (
                        <SettingsCheckRow
                            key={ms}
                            checked={roastSettings.pollIntervalMs === ms}
                            label={ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                            onChange={() => updateRoastSettings({ pollIntervalMs: ms })}
                        />
                    ))}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('rorSpan')} description={tk('rorSpanDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    {rorOptions.map((sec) => (
                        <SettingsCheckRow
                            key={sec}
                            checked={roastSettings.rorSpanSec === sec}
                            label={`${sec}s`}
                            onChange={() => updateRoastSettings({ rorSpanSec: sec })}
                        />
                    ))}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('dataVisibility')} description={tk('dataVisibilityDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    {visibilityOptions.map(({ key, labelKey, descKey }) => (
                        <SettingsCheckRow
                            key={key}
                            checked={roastSettings[key]}
                            label={t(labelKey)}
                            description={t(descKey)}
                            onChange={() => updateRoastSettings({ [key]: !roastSettings[key] })}
                        />
                    ))}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('eventMarkers')} description={tk('eventMarkersDescription')} />
                <SectionCard.Body className="grid gap-1.5">
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
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('axisRange')} description={tk('axisRangeDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    <RangeRow
                        label={tk('axisTemp')}
                        minVal={roastSettings.tempMinC}
                        maxVal={roastSettings.tempMaxC}
                        onMinChange={(v) => updateRoastSettings({ tempMinC: v })}
                        onMaxChange={(v) => updateRoastSettings({ tempMaxC: v })}
                        min={0}
                        max={500}
                        suffix="°C"
                    />
                    <RangeRow
                        label={tk('axisRoR')}
                        minVal={roastSettings.rorYMin}
                        maxVal={roastSettings.rorYMax}
                        onMinChange={(v) => updateRoastSettings({ rorYMin: v })}
                        onMaxChange={(v) => updateRoastSettings({ rorYMax: v })}
                        min={-30}
                        max={100}
                        suffix="°/min"
                    />
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('controlChart')} description={tk('controlChartDescription')} />
                <SectionCard.Body className="grid gap-3">
                    <div className="grid gap-1.5">
                        {controlSeriesOptions.map(({ key, labelKey, descKey }) => (
                            <SettingsCheckRow
                                key={key}
                                checked={roastSettings[key]}
                                label={t(labelKey)}
                                description={t(descKey)}
                                onChange={() => updateRoastSettings({ [key]: !roastSettings[key] })}
                            />
                        ))}
                    </div>
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('controlBandHeight')}</div>
                            <div className={settingsOptionDescCls}>{tk('controlBandHeightDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.controlChartHeightPct}
                            onChange={(v) => updateRoastSettings({ controlChartHeightPct: v })}
                            min={12}
                            max={40}
                            suffix="%"
                        />
                    </SettingsOptionRow>
                    <RangeRow
                        label={tk('controlY')}
                        minVal={roastSettings.controlYMin}
                        maxVal={roastSettings.controlYMax}
                        onMinChange={(v) => updateRoastSettings({ controlYMin: v })}
                        onMaxChange={(v) => updateRoastSettings({ controlYMax: v })}
                        min={-50}
                        max={500}
                    />
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('phaseTemperatures')} description={tk('phaseTemperaturesDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    {(
                        [
                            {
                                labelKey: 'yellowPoint',
                                descKey: 'yellowPointDescription',
                                key: 'yellowTempC' as const,
                            },
                            {
                                labelKey: 'fcStart',
                                descKey: 'fcStartDescription',
                                key: 'fcStartTempC' as const,
                            },
                        ] as const
                    ).map(({ labelKey, descKey, key }) => (
                        <SettingsOptionRow key={key} justify="between">
                            <div>
                                <div className={settingsOptionLabelCls}>{tk(labelKey)}</div>
                                <div className={settingsOptionDescCls}>{tk(descKey)}</div>
                            </div>
                            <NumberInput
                                value={roastSettings[key]}
                                onChange={(v) => updateRoastSettings({ [key]: v })}
                                min={50}
                                max={300}
                                suffix="°C"
                            />
                        </SettingsOptionRow>
                    ))}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('autoCharge')} description={tk('autoChargeDescription')} />
                <SectionCard.Body>
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('dropThreshold')}</div>
                            <div className={settingsOptionDescCls}>{tk('dropThresholdDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.autoChargeDropC}
                            onChange={(v) => updateRoastSettings({ autoChargeDropC: v })}
                            min={1}
                            max={30}
                            suffix="°C"
                        />
                    </SettingsOptionRow>
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('alerts')} description={tk('alertsDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    <SettingsCheckRow
                        checked={roastSettings.alertsEnabled}
                        label={tk('alertsEnabled')}
                        description={tk('alertsEnabledDescription')}
                        onChange={() => updateRoastSettings({ alertsEnabled: !roastSettings.alertsEnabled })}
                    />
                    <SettingsCheckRow
                        checked={roastSettings.alertSoundEnabled}
                        label={tk('alertSound')}
                        description={tk('alertSoundDescription')}
                        onChange={() => updateRoastSettings({ alertSoundEnabled: !roastSettings.alertSoundEnabled })}
                    />
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('alertRorCrash')}</div>
                            <div className={settingsOptionDescCls}>{tk('alertRorCrashDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.alertRorCrashCPerMin}
                            onChange={(v) => updateRoastSettings({ alertRorCrashCPerMin: v })}
                            min={-20}
                            max={20}
                            suffix="°C/min"
                        />
                    </SettingsOptionRow>
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('alertBtMax')}</div>
                            <div className={settingsOptionDescCls}>{tk('alertBtMaxDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.alertBtMaxC}
                            onChange={(v) => updateRoastSettings({ alertBtMaxC: v })}
                            min={100}
                            max={400}
                            suffix="°C"
                        />
                    </SettingsOptionRow>
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
};
