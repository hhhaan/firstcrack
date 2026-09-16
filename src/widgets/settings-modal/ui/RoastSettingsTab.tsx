import {
    ALERT_SOUND_KINDS,
    type EventMarkerStyle,
    fromDisplayTemp,
    isAlertSoundKind,
    type PidDropBehavior,
    type PollIntervalMs,
    playAlertSound,
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
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { Lock, Play } from 'lucide-react';
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
        value: 'both',
        labelKey: 'settings.tabs.roast.eventMarkerBoth',
        descKey: 'settings.tabs.roast.eventMarkerBothDescription',
    },
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

const TimeAlertRow = ({
    enabled,
    minutes,
    label,
    description,
    onEnabled,
    onMinutes,
}: {
    enabled: boolean;
    minutes: number;
    label: string;
    description: string;
    onEnabled: () => void;
    onMinutes: (v: number) => void;
}) => (
    <SettingsOptionRow justify="between" align="start">
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
            <input
                type="checkbox"
                checked={enabled}
                onChange={onEnabled}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
            />
            <div className="min-w-0">
                <div className={settingsOptionLabelCls}>{label}</div>
                <div className={settingsOptionDescCls}>{description}</div>
            </div>
        </label>
        <NumberInput value={minutes} onChange={onMinutes} min={1} max={30} suffix="min" />
    </SettingsOptionRow>
);

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
    // (델타/변화율 값 — autoChargeMinRateCPerSec·autoDropDropC·alertRorCrashCPerMin — 은 변환식이 달라 °C 고정)
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
                            value={roastSettings.autoChargeMinRateCPerSec}
                            onChange={(v) => updateRoastSettings({ autoChargeMinRateCPerSec: v })}
                            min={0.1}
                            max={15}
                            suffix="°C/s"
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
                    <SettingsCheckRow
                        checked={roastSettings.alertSoundEnabled}
                        label={tk('alertSound')}
                        description={tk('alertSoundDescription')}
                        onChange={() => updateRoastSettings({ alertSoundEnabled: !roastSettings.alertSoundEnabled })}
                    />
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('alertSoundKind')}</div>
                            <div className={settingsOptionDescCls}>{tk('alertSoundKindDescription')}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Select
                                value={roastSettings.alertSoundKind}
                                onValueChange={(v) => {
                                    if (isAlertSoundKind(v)) updateRoastSettings({ alertSoundKind: v });
                                }}
                                disabled={!roastSettings.alertSoundEnabled}
                            >
                                <SelectTrigger className="w-36" aria-label={tk('alertSoundKind')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ALERT_SOUND_KINDS.map((kind) => (
                                        <SelectItem key={kind} value={kind}>
                                            {tk(`alertSoundKinds.${kind}`)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <SurfaceButton
                                icon={<Play size={14} strokeWidth={2} />}
                                disabled={!roastSettings.alertSoundEnabled}
                                onClick={() => playAlertSound(roastSettings.alertSoundKind)}
                            >
                                {tk('alertSoundPreview')}
                            </SurfaceButton>
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
                    <TimeAlertRow
                        enabled={roastSettings.alertAfterChargeEnabled}
                        minutes={roastSettings.alertAfterChargeMin}
                        label={tk('alertAfterCharge')}
                        description={tk('alertAfterChargeDescription')}
                        onEnabled={() =>
                            updateRoastSettings({ alertAfterChargeEnabled: !roastSettings.alertAfterChargeEnabled })
                        }
                        onMinutes={(v) => updateRoastSettings({ alertAfterChargeMin: v })}
                    />
                    <TimeAlertRow
                        enabled={roastSettings.alertBeforeFcEnabled}
                        minutes={roastSettings.alertBeforeFcMin}
                        label={tk('alertBeforeFc')}
                        description={tk('alertBeforeFcDescription')}
                        onEnabled={() =>
                            updateRoastSettings({ alertBeforeFcEnabled: !roastSettings.alertBeforeFcEnabled })
                        }
                        onMinutes={(v) => updateRoastSettings({ alertBeforeFcMin: v })}
                    />
                    <TimeAlertRow
                        enabled={roastSettings.alertBeforeDropEnabled}
                        minutes={roastSettings.alertBeforeDropMin}
                        label={tk('alertBeforeDrop')}
                        description={tk('alertBeforeDropDescription')}
                        onEnabled={() =>
                            updateRoastSettings({ alertBeforeDropEnabled: !roastSettings.alertBeforeDropEnabled })
                        }
                        onMinutes={(v) => updateRoastSettings({ alertBeforeDropMin: v })}
                    />
                    <TimeAlertRow
                        enabled={roastSettings.alertAfterDropEnabled}
                        minutes={roastSettings.alertAfterDropMin}
                        label={tk('alertAfterDrop')}
                        description={tk('alertAfterDropDescription')}
                        onEnabled={() =>
                            updateRoastSettings({ alertAfterDropEnabled: !roastSettings.alertAfterDropEnabled })
                        }
                        onMinutes={(v) => updateRoastSettings({ alertAfterDropMin: v })}
                    />
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
};
