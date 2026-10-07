import {
    ALERT_SOUND_KINDS,
    AUTO_DROP_START_MIN_MAX,
    type EventMarkerStyle,
    FONT_SLIDER_MAX,
    FONT_SLIDER_MIN,
    fontScaleToSlider,
    fromDisplayTemp,
    isAlertSoundKind,
    // type PidDropBehavior, // PID 배출 화력 UI 복구 시 주석 해제
    type PollIntervalMs,
    playAlertSound,
    type RoastSettings,
    type RorSpanSec,
    sliderToFontScale,
    type TemperatureUnit,
    TIME_RANGE_MIN_DEFAULT,
    TIME_RANGE_PRESET_MIN,
    toDisplayTemp,
    updateRoastSettings,
    useBbpStore,
    useEffectivePollIntervalMs,
    useRoastSettings,
} from '@features/active-roast';
import { parseTemperatureTicks } from '@features/active-roast/lib/temperature';
import { FEATURE, useFeature } from '@shared/lib/features';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { Lock, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import { CurveStyleSection } from './CurveStyleSection';
import {
    SettingsCheckRow,
    SettingsOptionRow,
    settingsOptionDescCls,
    settingsOptionLabelCls,
} from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

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

// PID 미사용. 나중에 넣을 때 주석 해제.
// const pidDropBehaviorOptions: { value: PidDropBehavior; labelKey: string; descKey: string }[] = [
//     {
//         value: 'hold',
//         labelKey: 'settings.tabs.roast.pidDropHold',
//         descKey: 'settings.tabs.roast.pidDropHoldDescription',
//     },
//     {
//         value: 'zero',
//         labelKey: 'settings.tabs.roast.pidDropZero',
//         descKey: 'settings.tabs.roast.pidDropZeroDescription',
//     },
// ];

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

type BooleanSettingKey = {
    [Key in keyof RoastSettings]: RoastSettings[Key] extends boolean ? Key : never;
}[keyof RoastSettings];

type RoastCheckOption = {
    key: BooleanSettingKey;
    labelKey: string;
    descKey: string;
};

const profileSeriesOptions: RoastCheckOption[] = (
    [
        ['showProfileBt', 'profileBt'],
        ['showProfileEt', 'profileEt'],
        ['showProfileRor', 'profileRor'],
        ['showProfileDrum', 'profileDrum'],
        ['showProfileHeat', 'profileHeat'],
        ['showProfileFan', 'profileFan'],
    ] as const
).map(([key, label]) => ({
    key,
    labelKey: `settings.tabs.roast.${label}`,
    descKey: `settings.tabs.roast.${label}Description`,
}));

const RoastCheckRows = ({ options }: { options: readonly RoastCheckOption[] }) => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    return options.map(({ key, labelKey, descKey }) => (
        <SettingsCheckRow
            key={key}
            checked={roastSettings[key]}
            label={t(labelKey)}
            description={t(descKey)}
            onChange={() => updateRoastSettings({ [key]: !roastSettings[key] })}
        />
    ));
};

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

const numberInputWrapCls = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-main-bg';

const NumberInput = ({
    id,
    value,
    onChange,
    min,
    max,
    suffix,
}: {
    id?: string;
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
                id={id}
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
    <div className="flex min-w-0 flex-col gap-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between">
        <span className="text-[13px] text-[#374151] dark:text-[#ccc] shrink-0">{label}</span>
        <div className="flex items-center gap-2">
            <NumberInput value={minVal} onChange={onMinChange} min={min} max={maxVal - 1} suffix={suffix} />
            <span className="text-[12px] text-[#9CA3AF] dark:text-[#666]">–</span>
            <NumberInput value={maxVal} onChange={onMaxChange} min={minVal + 1} max={max} suffix={suffix} />
        </div>
    </div>
);

const TimeRangeRow = ({ custom, presetMin, customMin }: { custom: boolean; presetMin: number; customMin: number }) => {
    const { t } = useTranslation();
    const labelFor = (minutes: number) => t('settings.tabs.roast.timeRangeMinutes', { count: minutes });
    const selectValue = custom ? 'custom' : String(presetMin);
    return (
        <SettingsOptionRow justify="between" align="start">
            <label className={settingsOptionLabelCls} htmlFor={custom ? 'roast-timeRangeMin-custom' : undefined}>
                {t('settings.tabs.roast.axisTime')}
            </label>
            <div className="flex flex-col items-end gap-2">
                <Select
                    value={selectValue}
                    onValueChange={(value) => {
                        if (value === 'custom') {
                            updateRoastSettings({ timeRangeCustom: true });
                            return;
                        }
                        const minutes = Number(value);
                        if (!TIME_RANGE_PRESET_MIN.some((preset) => preset === minutes)) return;
                        updateRoastSettings({ timeRangeCustom: false, timeRangePresetMin: minutes });
                    }}
                >
                    <SelectTrigger className="w-48" aria-label={t('settings.tabs.roast.axisTime')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TIME_RANGE_PRESET_MIN.map((value) => {
                            const label = labelFor(value);
                            const text =
                                value === TIME_RANGE_MIN_DEFAULT
                                    ? t('settings.tabs.roast.axisTicksDefault', { value: label })
                                    : label;
                            return (
                                <SelectItem key={value} value={String(value)}>
                                    {text}
                                </SelectItem>
                            );
                        })}
                        <SelectItem value="custom">{t('settings.tabs.roast.axisTicksCustom')}</SelectItem>
                    </SelectContent>
                </Select>
                {custom && (
                    <NumberInput
                        id="roast-timeRangeMin-custom"
                        value={customMin}
                        onChange={(value) => updateRoastSettings({ timeRangeMin: Math.round(value) })}
                        min={1}
                        max={180}
                        suffix={t('settings.tabs.roast.axisRangeMinutes')}
                    />
                )}
            </div>
        </SettingsOptionRow>
    );
};

const nextTickTab = (key: string, index: number): number | null => {
    if (key === 'Home') return 0;
    if (key === 'End') return 1;
    if (key === 'ArrowLeft' || key === 'ArrowRight') return 1 - index;
    return null;
};

const DisplaySmoothingSection = ({
    setting,
    committed,
}: {
    setting: 'btSmoothing' | 'etSmoothing';
    committed: number;
}) => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? String(committed);
    const commit = (value: string) => {
        setDraft(null);
        const next = Number(value);
        if (value.trim() && Number.isFinite(next) && next !== committed) {
            updateRoastSettings({ [setting]: next });
        }
    };

    return (
        <SettingsSection group="sensors">
            <SettingsSection.Header title={tk(setting)} description={tk(`${setting}Description`)} />
            <SettingsSection.Body className="grid gap-2">
                <div className="flex items-center gap-3">
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={shown === '' ? committed : Number(shown)}
                        aria-label={tk(setting)}
                        aria-valuetext={`${shown || committed} / 100`}
                        className="h-5 w-full accent-palette-black"
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        onPointerUp={(event) => commit(event.currentTarget.value)}
                        onLostPointerCapture={(event) => commit(event.currentTarget.value)}
                        onPointerCancel={(event) => commit(event.currentTarget.value)}
                        onKeyUp={(event) => commit(event.currentTarget.value)}
                        onBlur={(event) => commit(event.currentTarget.value)}
                    />
                    <div className={numberInputWrapCls}>
                        <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={shown}
                            aria-label={tk(`${setting}Value`)}
                            onChange={(event) => setDraft(event.currentTarget.value)}
                            onBlur={(event) => commit(event.currentTarget.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') commit(event.currentTarget.value);
                            }}
                            className="w-14 bg-transparent text-right text-[13px] font-medium text-primary outline-none"
                        />
                        <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">/ 100</span>
                    </div>
                </div>
                <div className="flex justify-between text-[12px] text-muted">
                    <span>{tk('btSmoothingFast')}</span>
                    <span>{tk('btSmoothingSmooth')}</span>
                </div>
                <SurfaceButton
                    className="justify-self-start"
                    onClick={() => {
                        setDraft(null);
                        updateRoastSettings({ [setting]: 0 });
                    }}
                >
                    {tk('btSmoothingReset')}
                </SurfaceButton>
            </SettingsSection.Body>
        </SettingsSection>
    );
};

export const RoastSettingsTab = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const [ticksDraft, setTicksDraft] = useState<{ value: string; unit: TemperatureUnit } | null>(null);
    const [ticksError, setTicksError] = useState(false);
    const committedFontPct = fontScaleToSlider(roastSettings.fontScalePct);
    const [fontDraft, setFontDraft] = useState<number | null>(null);
    const fontSizePct = fontDraft ?? committedFontPct;
    const commitFontSlider = (slider: number) => {
        setFontDraft(null);
        const next = sliderToFontScale(slider);
        if (next !== roastSettings.fontScalePct) updateRoastSettings({ fontScalePct: next });
    };
    const canFastPoll = useFeature(FEATURE.fastPolling);
    const effectivePollMs = useEffectivePollIntervalMs();
    const [showPollUpgradeHint, setShowPollUpgradeHint] = useState(false);
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const autoDropDescription = t('settings.tabs.roast.autoDropDescription', {
        minutes: roastSettings.autoDropStartMin,
    });

    // 절대 온도 입력은 표시 단위를 따르고 저장은 항상 °C. 경계는 °C에서 합성한 뒤 한 번만 변환한다.
    // (델타/변화율 값 — alertRorCrashCPerMin — 은 변환식이 달라 °C 고정)
    const unit = roastSettings.temperatureUnit;
    const ticksInvalid = ticksError && ticksDraft?.unit === unit;
    const customTicksActive = roastSettings.tempAxisMode === 'list';
    const tempSuffix = `°${unit}`;
    const dispT = (celsius: number) => Math.round(toDisplayTemp(celsius, unit));
    const storeT = (display: number) => fromDisplayTemp(display, unit);

    return (
        <div className="settings-compact grid gap-0">
            <SettingsSection group="general">
                <SettingsSection.Header title={tk('temperatureUnit')} description={tk('temperatureUnitDescription')} />
                <SettingsSection.Body className="flex-row flex-wrap gap-x-6 gap-y-1">
                    {temperatureOptions.map((u) => (
                        <SettingsCheckRow
                            key={u}
                            type="radio"
                            name="temperatureUnit"
                            checked={roastSettings.temperatureUnit === u}
                            label={`°${u}`}
                            onChange={() => updateRoastSettings({ temperatureUnit: u })}
                        />
                    ))}
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="alerts">
                <SettingsSection.Header title={tk('alerts')} description={tk('alertsDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
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
                            updateRoastSettings({
                                alertAfterChargeEnabled: !roastSettings.alertAfterChargeEnabled,
                            })
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
                            updateRoastSettings({
                                alertBeforeDropEnabled: !roastSettings.alertBeforeDropEnabled,
                            })
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
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="automation">
                <SettingsSection.Header title={tk('autoCharge')} description={tk('autoChargeDescription')} />
                <SettingsSection.Body className="grid gap-3">
                    <SettingsCheckRow
                        checked={roastSettings.autoChargeEnabled}
                        label={tk('autoChargeEnabled')}
                        description={tk('autoChargeDescription')}
                        onChange={() => updateRoastSettings({ autoChargeEnabled: !roastSettings.autoChargeEnabled })}
                    />
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('autoChargeSensitivity')}</div>
                            <div className={settingsOptionDescCls}>{tk('autoChargeSensitiveDescription')}</div>
                        </div>
                        <Select
                            value={roastSettings.autoChargeMode}
                            disabled={!roastSettings.autoChargeEnabled}
                            onValueChange={(value) =>
                                updateRoastSettings({
                                    autoChargeMode: value === 'sensitive' ? 'sensitive' : 'standard',
                                })
                            }
                        >
                            <SelectTrigger className="w-36" aria-label={tk('autoChargeSensitivity')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="standard">{tk('autoChargeStandard')}</SelectItem>
                                <SelectItem value="sensitive">{tk('autoChargeSensitive')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </SettingsOptionRow>
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="automation">
                <SettingsSection.Header title={tk('autoDrop')} description={autoDropDescription} />
                <SettingsSection.Body className="grid gap-3">
                    <SettingsCheckRow
                        checked={roastSettings.autoDropEnabled}
                        label={tk('autoDropEnabled')}
                        description={autoDropDescription}
                        onChange={() => updateRoastSettings({ autoDropEnabled: !roastSettings.autoDropEnabled })}
                    />
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('autoDropStart')}</div>
                            <div className={settingsOptionDescCls}>{tk('autoDropStartDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.autoDropStartMin}
                            onChange={(v) => updateRoastSettings({ autoDropStartMin: v })}
                            min={1}
                            max={AUTO_DROP_START_MIN_MAX}
                            suffix={tk('autoDropStartUnit')}
                        />
                    </SettingsOptionRow>
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('autoDropSensitivity')}</div>
                            <div className={settingsOptionDescCls}>{tk('autoDropSensitivityDescription')}</div>
                        </div>
                        <Select
                            value={roastSettings.autoDropMode}
                            disabled={!roastSettings.autoDropEnabled}
                            onValueChange={(value) =>
                                updateRoastSettings({
                                    autoDropMode: value === 'sensitive' ? 'sensitive' : 'standard',
                                })
                            }
                        >
                            <SelectTrigger className="w-36" aria-label={tk('autoDropSensitivity')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="standard">{tk('autoChargeStandard')}</SelectItem>
                                <SelectItem value="sensitive">{tk('autoChargeSensitive')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </SettingsOptionRow>
                </SettingsSection.Body>
            </SettingsSection>

            {/* PID 미사용. 나중에 넣을 때 주석 해제.
            <SettingsSection group="automation">
                <SettingsSection.Header title={tk('pidDropBehavior')} description={tk('pidDropBehaviorDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
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
                </SettingsSection.Body>
            </SettingsSection>
            */}

            <SettingsSection group="automation">
                <SettingsSection.Header title={tk('bbp')} description={tk('bbpDescription')} />
                <SettingsSection.Body className="grid gap-3">
                    <SettingsCheckRow
                        checked={roastSettings.bbpEnabled}
                        label={tk('bbpEnabled')}
                        onChange={() => {
                            if (roastSettings.bbpEnabled) useBbpStore.getState().abort();
                            updateRoastSettings({ bbpEnabled: !roastSettings.bbpEnabled });
                        }}
                    />
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="automation">
                <SettingsSection.Header
                    title={tk('phaseTemperatures')}
                    description={tk('phaseTemperaturesDescription')}
                />
                <SettingsSection.Body className="grid gap-1.5">
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
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="automation">
                <SettingsSection.Header title={tk('fcMarking')} description={tk('fcMarkingDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
                    <SettingsCheckRow
                        checked={roastSettings.fcDualMarkEnabled}
                        label={tk('fcDualMark')}
                        description={tk('fcDualMarkDescription')}
                        onChange={() => updateRoastSettings({ fcDualMarkEnabled: !roastSettings.fcDualMarkEnabled })}
                    />
                </SettingsSection.Body>
            </SettingsSection>
            <SettingsSection group="display">
                <SettingsSection.Header title={tk('dataVisibility')} description={tk('dataVisibilityDescription')} />
                <SettingsSection.Body className="grid items-start gap-x-6 gap-y-1 @[480px]:grid-cols-2">
                    <RoastCheckRows options={visibilityOptions} />
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="display">
                <SettingsSection.Header title={tk('profileSeries')} description={tk('profileSeriesDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
                    <RoastCheckRows options={profileSeriesOptions} />
                </SettingsSection.Body>
            </SettingsSection>

            <CurveStyleSection />

            <SettingsSection group="display">
                <SettingsSection.Header title={tk('eventMarkers')} description={tk('eventMarkersDescription')} />
                <SettingsSection.Body className="grid gap-x-6 gap-y-1 @[480px]:grid-cols-3">
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

            <SettingsSection group="axes">
                <SettingsSection.Header title={tk('axisRange')} description={tk('axisRangeDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
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
                    <TimeRangeRow
                        custom={roastSettings.timeRangeCustom}
                        presetMin={roastSettings.timeRangePresetMin}
                        customMin={roastSettings.timeRangeMin}
                    />
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="axes">
                <SettingsSection.Header title={tk('axisTicks')} description={tk('axisTicksDescription')} />
                <SettingsSection.Body className="grid gap-1.5">
                    <SettingsOptionRow justify="between" className={customTicksActive ? 'border-b-0!' : undefined}>
                        <span className={settingsOptionLabelCls}>{tk('tempGridInterval')}</span>
                        <Select
                            value={customTicksActive ? 'list' : String(roastSettings.tempGridPresetInterval)}
                            onValueChange={(value) => {
                                if (value === 'list') updateRoastSettings({ tempAxisMode: 'list' });
                                else if ([10, 15, 20, 30].includes(Number(value)))
                                    updateRoastSettings({
                                        tempAxisMode: 'preset',
                                        tempGridPresetInterval: Number(value),
                                    });
                                else return;
                                setTicksDraft(null);
                                setTicksError(false);
                            }}
                        >
                            <SelectTrigger className="w-48" aria-label={tk('tempGridInterval')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {[10, 15, 20, 30].map((value) => (
                                    <SelectItem key={value} value={String(value)}>
                                        {value === 10
                                            ? t('settings.tabs.roast.axisTicksDefault', { value: `10°${unit}` })
                                            : `${value}°${unit}`}
                                    </SelectItem>
                                ))}
                                <SelectItem value="list">{tk('axisTicksCustom')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </SettingsOptionRow>
                    {customTicksActive && (
                        <div className="grid gap-3 border-b border-border-subtle pb-3">
                            <div className="flex flex-col gap-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between">
                                <span className={settingsOptionLabelCls}>{tk('tempTickMode')}</span>
                                <div
                                    role="tablist"
                                    aria-label={tk('tempTickMode')}
                                    className="flex rounded-lg bg-primary/5 p-1"
                                >
                                    {(['interval', 'list'] as const).map((mode, index) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            role="tab"
                                            id={`roast-temp-mode-${mode}`}
                                            aria-selected={roastSettings.tempTickMode === mode}
                                            aria-controls="roast-temp-mode-panel"
                                            tabIndex={roastSettings.tempTickMode === mode ? 0 : -1}
                                            className={`rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary ${roastSettings.tempTickMode === mode ? 'bg-main-bg text-primary shadow-sm' : 'text-muted'}`}
                                            onClick={() => {
                                                updateRoastSettings({ tempTickMode: mode });
                                                setTicksDraft(null);
                                                setTicksError(false);
                                            }}
                                            onKeyDown={(event) => {
                                                const nextIndex = nextTickTab(event.key, index);
                                                if (nextIndex == null) return;
                                                event.preventDefault();
                                                const next =
                                                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                                        '[role="tab"]',
                                                    )[nextIndex];
                                                next?.focus();
                                                next?.click();
                                            }}
                                        >
                                            {tk(mode === 'interval' ? 'tempTickInterval' : 'tempTickList')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div
                                role="tabpanel"
                                id="roast-temp-mode-panel"
                                aria-labelledby={`roast-temp-mode-${roastSettings.tempTickMode}`}
                            >
                                {roastSettings.tempTickMode === 'interval' ? (
                                    <SettingsOptionRow justify="between">
                                        <label className={settingsOptionLabelCls} htmlFor="roast-temp-grid-custom">
                                            {tk('customTempInterval')}
                                        </label>
                                        <NumberInput
                                            id="roast-temp-grid-custom"
                                            value={roastSettings.tempGridInterval}
                                            onChange={(value) => updateRoastSettings({ tempGridInterval: value })}
                                            min={1}
                                            max={500}
                                            suffix={tempSuffix}
                                        />
                                    </SettingsOptionRow>
                                ) : (
                                    <div className="grid gap-2">
                                        <label className={settingsOptionLabelCls} htmlFor="roast-temp-ticks">
                                            {tk('customTempTicks')} (°{unit})
                                        </label>
                                        <input
                                            id="roast-temp-ticks"
                                            type="text"
                                            maxLength={2000}
                                            value={
                                                ticksDraft?.unit === unit
                                                    ? ticksDraft.value
                                                    : roastSettings.tempTicksC
                                                          .map((value) => Number(toDisplayTemp(value, unit).toFixed(6)))
                                                          .join(', ')
                                            }
                                            placeholder="100, 150, 180, 200, 250"
                                            aria-invalid={ticksInvalid}
                                            aria-describedby="roast-temp-ticks-hint"
                                            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-xs text-primary outline-none focus:border-primary"
                                            onChange={(event) =>
                                                setTicksDraft({ value: event.currentTarget.value, unit })
                                            }
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                                                    event.currentTarget.blur();
                                            }}
                                            onBlur={(event) => {
                                                if (ticksDraft?.unit !== unit) return;
                                                const ticks = parseTemperatureTicks(event.currentTarget.value, unit);
                                                setTicksError(ticks === null);
                                                if (ticks !== null) {
                                                    updateRoastSettings({ tempTicksC: ticks });
                                                    setTicksDraft(null);
                                                }
                                            }}
                                        />
                                        <p
                                            id="roast-temp-ticks-hint"
                                            role={ticksInvalid ? 'alert' : undefined}
                                            className={`text-xs ${ticksInvalid ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}
                                        >
                                            {tk(ticksInvalid ? 'customTempTicksError' : 'customTempTicksDescription')}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {(
                        [
                            {
                                key: 'tempLabelEvery',
                                mode: 'tempLabelCustom',
                                preset: 'tempLabelPresetEvery',
                                values: [5, 1, 2, 3],
                                label: 'tempLabelEvery',
                                defaultValue: 5,
                                max: 500,
                                suffix: tk('axisTickSteps'),
                            },
                            {
                                key: 'timeTickIntervalSec',
                                mode: 'timeTickCustom',
                                preset: 'timeTickPresetSec',
                                values: [60, 30, 90, 120],
                                label: 'timeTickInterval',
                                defaultValue: 60,
                                max: 3600,
                                suffix: tk('axisTickSeconds'),
                            },
                        ] as const
                    ).map(({ key, mode, preset, values, label, defaultValue, max, suffix }) => {
                        const disabled =
                            key === 'tempLabelEvery' && customTicksActive && roastSettings.tempTickMode === 'list';
                        if (disabled) return null;
                        const formatValue = (count: number) =>
                            key === 'tempLabelEvery'
                                ? t('settings.tabs.roast.tempLabelEveryValue', { count })
                                : t('settings.tabs.roast.timeTickSeconds', { count });
                        return (
                            <SettingsOptionRow key={key} justify="between" align="start">
                                <label
                                    className={settingsOptionLabelCls}
                                    htmlFor={roastSettings[mode] ? `roast-${key}-custom` : undefined}
                                >
                                    {tk(label)}
                                </label>
                                <div className="flex flex-col items-end gap-2">
                                    <Select
                                        value={roastSettings[mode] ? 'custom' : String(roastSettings[preset])}
                                        onValueChange={(value) => {
                                            if (value === 'custom') updateRoastSettings({ [mode]: true });
                                            else if (values.some((presetValue) => presetValue === Number(value)))
                                                updateRoastSettings({ [mode]: false, [preset]: Number(value) });
                                        }}
                                    >
                                        <SelectTrigger className="w-48" aria-label={tk(label)}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {values.map((value) => (
                                                <SelectItem key={value} value={String(value)}>
                                                    {value === defaultValue
                                                        ? t('settings.tabs.roast.axisTicksDefault', {
                                                              value: formatValue(value),
                                                          })
                                                        : formatValue(value)}
                                                </SelectItem>
                                            ))}
                                            <SelectItem value="custom">{tk('axisTicksCustom')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {roastSettings[mode] && (
                                        <NumberInput
                                            id={`roast-${key}-custom`}
                                            value={roastSettings[key]}
                                            onChange={(value) => updateRoastSettings({ [key]: Math.round(value) })}
                                            min={1}
                                            max={max}
                                            suffix={suffix}
                                        />
                                    )}
                                </div>
                            </SettingsOptionRow>
                        );
                    })}
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="axes">
                <SettingsSection.Header title={tk('controlChart')} description={tk('controlChartDescription')} />
                <SettingsSection.Body className="grid gap-3">
                    <div className="grid gap-1.5">
                        <RoastCheckRows options={controlSeriesOptions} />
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
                </SettingsSection.Body>
            </SettingsSection>
            <DisplaySmoothingSection setting="btSmoothing" committed={roastSettings.btSmoothing} />
            <DisplaySmoothingSection setting="etSmoothing" committed={roastSettings.etSmoothing} />

            <SettingsSection group="sensors">
                <SettingsSection.Header title={tk('rorSpan')} description={tk('rorSpanDescription')} />
                <SettingsSection.Body className="flex-row flex-wrap gap-x-6 gap-y-1">
                    {rorOptions.map((sec) => (
                        <SettingsCheckRow
                            key={sec}
                            type="radio"
                            name="rorSpanSec"
                            checked={roastSettings.rorSpanSec === sec}
                            label={`${sec}s`}
                            onChange={() => updateRoastSettings({ rorSpanSec: sec })}
                        />
                    ))}
                </SettingsSection.Body>
            </SettingsSection>

            <SettingsSection group="general">
                <SettingsSection.Header title={tk('updateRate')} description={tk('updateRateDescription')} />
                <SettingsSection.Body className="flex-row flex-wrap gap-x-6 gap-y-1">
                    {pollOptions.map((ms) => {
                        const locked = ms === 500 && !canFastPoll;
                        return (
                            <SettingsCheckRow
                                key={ms}
                                type="radio"
                                name="pollIntervalMs"
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
                        <div className="flex basis-full items-center gap-2 px-1 pt-0.5 text-[12px] text-palette-teal">
                            <Lock size={12} className="shrink-0" aria-hidden />
                            {tk('updateRateProHint')}
                        </div>
                    )}
                </SettingsSection.Body>
            </SettingsSection>
        </div>
    );
};
