import {
    ALERT_SOUND_TONES,
    type EventMarkerStyle,
    fromDisplayTemp,
    type PidDropBehavior,
    type PollIntervalMs,
    playAlertTone,
    type RorSpanSec,
    type TemperatureUnit,
    toDisplayTemp,
    updateRoastSettings,
    useEffectivePollIntervalMs,
    useRoastSettings,
} from '@features/active-roast';
import { FEATURE, useFeature } from '@shared/lib/features';
import { Badge } from '@shared/ui/Badge';
import { SectionCard } from '@shared/ui/SectionCard';
import { Lock } from 'lucide-react';
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

const pidDropBehaviorOptions: { value: PidDropBehavior; labelKey: string; descKey: string }[] = [
    {
        value: 'hold',
        labelKey: 'settings.tabs.roast.pidDropHold',
        descKey: 'settings.tabs.roast.pidDropHoldDescription',
    },
    {
        value: 'zero',
        labelKey: 'settings.tabs.roast.pidDropZero',
        descKey: 'settings.tabs.roast.pidDropZeroDescription',
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

const checkboxCls = 'w-4 h-4 accent-[#111827] dark:accent-[#F2F2F2] shrink-0 mt-0.5';

/** Same track/thumb as MarginSlider — widgets cannot import each other. */
const sliderThumbCls = [
    'appearance-none bg-transparent cursor-pointer',
    '[&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-main-bg',
    '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:shadow-ring',
    '[&::-webkit-slider-thumb]:-mt-[5px]',
    '[&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
    '[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full',
    '[&::-moz-range-thumb]:bg-main-bg [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border',
    '[&::-moz-range-progress]:h-2.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary',
].join(' ');

const SOUND_VOL_MIN = 10;
const SOUND_VOL_MAX = 100;

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
    const canFastPoll = useFeature(FEATURE.fastPolling);
    const effectivePollMs = useEffectivePollIntervalMs();
    const [showPollUpgradeHint, setShowPollUpgradeHint] = useState(false);
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);

    // 절대 온도 입력은 표시 단위를 따르고 저장은 항상 °C. 경계는 °C에서 합성한 뒤 한 번만 변환한다.
    // (델타/변화율 값 — autoChargeDropC·autoDropDropC·alertRorCrashCPerMin — 은 변환식이 달라 °C 고정)
    const unit = roastSettings.temperatureUnit;
    const tempSuffix = `°${unit}`;
    const dispT = (celsius: number) => Math.round(toDisplayTemp(celsius, unit));
    const storeT = (display: number) => fromDisplayTemp(display, unit);

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
                    {pollOptions.map((ms) => {
                        const locked = ms === 500 && !canFastPoll;
                        return (
                            <SettingsCheckRow
                                key={ms}
                                checked={effectivePollMs === ms}
                                label={ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                                trailing={
                                    locked ? (
                                        <>
                                            <Lock size={12} className="text-[#9CA3AF] dark:text-[#666]" aria-hidden />
                                            <Badge
                                                size="sm"
                                                className="text-[9px] font-bold text-palette-teal bg-palette-teal/15"
                                            >
                                                Pro
                                            </Badge>
                                        </>
                                    ) : undefined
                                }
                                onChange={() => {
                                    if (locked) {
                                        setShowPollUpgradeHint(true);
                                        return;
                                    }
                                    updateRoastSettings({ pollIntervalMs: ms });
                                }}
                            />
                        );
                    })}
                    {showPollUpgradeHint && (
                        <div className="flex items-center gap-2 px-1 pt-0.5 text-[12px] text-palette-teal">
                            <Lock size={12} className="shrink-0" aria-hidden />
                            {tk('updateRateProHint')}
                        </div>
                    )}
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
                <SectionCard.Header title={tk('pidDropBehavior')} description={tk('pidDropBehaviorDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    {pidDropBehaviorOptions.map(({ value, labelKey, descKey }) => (
                        <SettingsCheckRow
                            key={value}
                            type="radio"
                            name="pidDropBehavior"
                            checked={roastSettings.pidDropBehavior === value}
                            label={t(labelKey)}
                            description={t(descKey)}
                            onChange={() => updateRoastSettings({ pidDropBehavior: value })}
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
                    <SettingsOptionRow justify="between" align="start">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                            <input
                                type="checkbox"
                                checked={roastSettings.autoYellowEnabled}
                                onChange={() =>
                                    updateRoastSettings({ autoYellowEnabled: !roastSettings.autoYellowEnabled })
                                }
                                className="mt-0.5 h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                            />
                            <div className="min-w-0">
                                <div className={settingsOptionLabelCls}>{tk('yellowPoint')}</div>
                                <div className={settingsOptionDescCls}>{tk('yellowPointDescription')}</div>
                            </div>
                        </label>
                        <NumberInput
                            value={dispT(roastSettings.yellowTempC)}
                            onChange={(v) => updateRoastSettings({ yellowTempC: storeT(v) })}
                            min={dispT(50)}
                            max={dispT(300)}
                            suffix={tempSuffix}
                        />
                    </SettingsOptionRow>
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('fcMarking')} description={tk('fcMarkingDescription')} />
                <SectionCard.Body className="grid gap-1.5">
                    <SettingsCheckRow
                        checked={roastSettings.fcDualMarkEnabled}
                        label={tk('fcDualMark')}
                        description={tk('fcDualMarkDescription')}
                        onChange={() => updateRoastSettings({ fcDualMarkEnabled: !roastSettings.fcDualMarkEnabled })}
                    />
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header title={tk('autoCharge')} description={tk('autoChargeDescription')} />
                <SectionCard.Body className="grid gap-3">
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
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('autoDropSensitivity')}</div>
                            <div className={settingsOptionDescCls}>{tk('autoDropSensitivityDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.autoDropDropC}
                            onChange={(v) => updateRoastSettings({ autoDropDropC: v })}
                            min={2}
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
                    <SettingsOptionRow align="start">
                        <input
                            id="alert-sound-enabled"
                            type="checkbox"
                            className={checkboxCls}
                            checked={roastSettings.alertSoundEnabled}
                            onChange={() =>
                                updateRoastSettings({ alertSoundEnabled: !roastSettings.alertSoundEnabled })
                            }
                        />
                        <div className="min-w-0 flex-1 flex flex-col gap-2">
                            <div className="flex items-start justify-between gap-3">
                                <label htmlFor="alert-sound-enabled" className="min-w-0 cursor-pointer">
                                    <div className={settingsOptionLabelCls}>{tk('alertSound')}</div>
                                    <div className={settingsOptionDescCls}>{tk('alertSoundDescription')}</div>
                                </label>
                                {roastSettings.alertSoundEnabled ? (
                                    <span className="text-base font-semibold text-primary tabular-nums shrink-0 leading-snug">
                                        {roastSettings.alertSoundVolume}%
                                    </span>
                                ) : null}
                            </div>
                            {roastSettings.alertSoundEnabled ? (
                                <>
                                    <div className="relative h-8 flex items-center">
                                        <div
                                            className="absolute inset-x-0 h-2.5 rounded-full bg-surface dark:bg-surface-elevated pointer-events-none overflow-hidden"
                                            aria-hidden
                                        >
                                            <div
                                                className="h-full bg-primary"
                                                style={{
                                                    width: `${((roastSettings.alertSoundVolume - SOUND_VOL_MIN) / (SOUND_VOL_MAX - SOUND_VOL_MIN)) * 100}%`,
                                                }}
                                            />
                                        </div>
                                        <input
                                            id="alert-sound-volume"
                                            type="range"
                                            min={SOUND_VOL_MIN}
                                            max={SOUND_VOL_MAX}
                                            step={1}
                                            value={roastSettings.alertSoundVolume}
                                            aria-label={tk('alertSoundVolume')}
                                            aria-valuemin={SOUND_VOL_MIN}
                                            aria-valuemax={SOUND_VOL_MAX}
                                            aria-valuenow={roastSettings.alertSoundVolume}
                                            onChange={(e) =>
                                                updateRoastSettings({ alertSoundVolume: Number(e.target.value) })
                                            }
                                            className={`relative z-10 w-full h-8 ${sliderThumbCls}`}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {ALERT_SOUND_TONES.map((tone) => {
                                            const on = roastSettings.alertSoundTone === tone;
                                            return (
                                                <button
                                                    key={tone}
                                                    type="button"
                                                    onClick={() => {
                                                        updateRoastSettings({ alertSoundTone: tone });
                                                        playAlertTone(roastSettings.alertSoundVolume, tone);
                                                    }}
                                                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors border-none ${
                                                        on
                                                            ? 'bg-primary text-white dark:bg-white dark:text-primary'
                                                            : 'bg-surface dark:bg-surface-elevated text-muted hover:text-secondary'
                                                    }`}
                                                >
                                                    {tk(tone === 'soft' ? 'alertSoundSoft' : 'alertSoundAlarm')}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : null}
                        </div>
                    </SettingsOptionRow>
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
                            value={dispT(roastSettings.alertBtMaxC)}
                            onChange={(v) => updateRoastSettings({ alertBtMaxC: storeT(v) })}
                            min={dispT(100)}
                            max={dispT(400)}
                            suffix={tempSuffix}
                        />
                    </SettingsOptionRow>
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
};
