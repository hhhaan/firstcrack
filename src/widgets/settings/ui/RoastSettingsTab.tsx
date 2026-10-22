import {
    ALERT_SOUND_KINDS,
    AUTO_DROP_START_MIN_MAX,
    type EventMarkerStyle,
    FONT_SLIDER_MAX,
    FONT_SLIDER_MIN,
    fontScaleToSlider,
    fromDisplayRoR,
    fromDisplayTemp,
    fromDisplayTempDelta,
    isAlertSoundKind,
    // type PidDropBehavior, // PID 배출 화력 UI 복구 시 주석 해제
    type PollIntervalMs,
    playAlertSound,
    type RoastSettings,
    type RorSpanSec,
    rorUnitLabel,
    sliderToFontScale,
    type TemperatureUnit,
    TIME_RANGE_MIN_DEFAULT,
    TIME_RANGE_PRESET_MIN,
    toDisplayRoR,
    toDisplayTemp,
    toDisplayTempDelta,
    updateRoastSettings,
    useBbpStore,
    useEffectivePollIntervalMs,
    useRoastSettings,
} from '@features/active-roast';
import { parseRorTicks, parseTemperatureTicks } from '@features/active-roast/lib/temperature';
import { FEATURE, useFeature } from '@shared/lib/features';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { Lock, Play } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import { BatchTitleSettings } from './BatchTitleSettings';
import { CurveStyleSection } from './CurveStyleSection';
import { EventButtonSection } from './EventButtonSection';
import { RoastingSettingsImport } from './RoastingSettingsImport';
import {
    SettingsCheckRow,
    SettingsOptionRow,
    settingsOptionDescCls,
    settingsOptionLabelCls,
    settingsOptionSwitchCls,
} from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

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

const RoastCheckRows = ({ options }: { options: readonly RoastCheckOption[] }) => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    return options.map(({ key, labelKey, descKey }) => (
        <SettingsCheckRow
            key={key}
            type="checkbox"
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
    ariaLabel,
    integer = false,
    step = 1,
}: {
    id?: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    suffix?: string;
    ariaLabel?: string;
    integer?: boolean;
    step?: number;
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
                aria-label={ariaLabel}
                value={local}
                valueIsNumericString
                allowNegative
                decimalScale={integer ? 0 : undefined}
                onValueChange={(values) => {
                    setLocal(values.value);
                    if (integer || values.floatValue === undefined) return;
                    onChange(clamp(values.floatValue));
                }}
                onBlur={(event) => {
                    const typed = event.currentTarget.value;
                    if (!integer) {
                        if (typed === '') {
                            const fallback = min ?? 0;
                            setLocal(String(fallback));
                            onChange(fallback);
                        }
                        return;
                    }
                    const parsed = Number(typed);
                    const stepped = Number.isFinite(parsed) ? Math.round(parsed / step) * step : Number.NaN;
                    const next = Number.isFinite(stepped) ? clamp(stepped) : (min ?? value);
                    setLocal(String(next));
                    if (next !== value) onChange(next);
                }}
                className="w-14 bg-transparent text-[13px] font-medium text-[#111827] dark:text-primary text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            {suffix && <span className="text-[12px] text-[#6B7280] dark:text-muted">{suffix}</span>}
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
}) => {
    const id = useId();
    return (
        <SettingsOptionRow justify="between">
            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <div className={settingsOptionLabelCls}>{label}</div>
                <div id={`${id}-description`} className={settingsOptionDescCls}>
                    {description}
                </div>
            </label>
            <div className="flex shrink-0 items-center gap-4">
                <NumberInput value={minutes} onChange={onMinutes} min={1} max={30} suffix="min" />
                <input
                    id={id}
                    type="checkbox"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={label}
                    aria-describedby={`${id}-description`}
                    checked={enabled}
                    onChange={onEnabled}
                    className={settingsOptionSwitchCls}
                />
            </div>
        </SettingsOptionRow>
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
    minId,
    maxId,
    minAriaLabel,
    maxAriaLabel,
}: {
    label: string;
    minVal: number;
    maxVal: number;
    onMinChange: (v: number) => void;
    onMaxChange: (v: number) => void;
    min?: number;
    max?: number;
    suffix?: string;
    minId?: string;
    maxId?: string;
    minAriaLabel?: string;
    maxAriaLabel?: string;
}) => (
    <div className="flex min-w-0 flex-col gap-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between">
        <span className="text-[13px] text-[#374151] dark:text-[#ccc] shrink-0">{label}</span>
        <div className="flex items-center gap-2">
            <NumberInput
                id={minId}
                ariaLabel={minAriaLabel}
                value={minVal}
                onChange={onMinChange}
                min={min}
                max={maxVal - 1}
                suffix={suffix}
            />
            <span className="text-[12px] text-[#9CA3AF] dark:text-[#666]">–</span>
            <NumberInput
                id={maxId}
                ariaLabel={maxAriaLabel}
                value={maxVal}
                onChange={onMaxChange}
                min={minVal + 1}
                max={max}
                suffix={suffix}
            />
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

const HORIZONTAL_GRID_PRESETS = [5, 10] as const;
const isPresetValue = (presets: readonly number[], value: string) => presets.includes(Number(value));

type TickMode = 'interval' | 'list';

const nextTickTab = (key: string, index: number): number | null => {
    if (key === 'Home') return 0;
    if (key === 'End') return 1;
    if (key === 'ArrowLeft' || key === 'ArrowRight') return 1 - index;
    return null;
};

const TickModeTabs = ({
    idPrefix,
    mode,
    label,
    intervalLabel,
    listLabel,
    onChange,
}: {
    idPrefix: string;
    mode: TickMode;
    label: string;
    intervalLabel: string;
    listLabel: string;
    onChange: (mode: TickMode) => void;
}) => (
    <div className="flex flex-col gap-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between">
        <span className={settingsOptionLabelCls}>{label}</span>
        <div role="tablist" aria-label={label} className="flex rounded-lg bg-primary/5 p-1">
            {(['interval', 'list'] as const).map((item, index) => (
                <button
                    key={item}
                    type="button"
                    role="tab"
                    id={`${idPrefix}-${item}`}
                    aria-selected={mode === item}
                    aria-controls={`${idPrefix}-panel`}
                    tabIndex={mode === item ? 0 : -1}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary ${mode === item ? 'bg-main-bg text-primary shadow-sm' : 'text-muted'}`}
                    onClick={() => onChange(item)}
                    onKeyDown={(event) => {
                        const nextIndex = nextTickTab(event.key, index);
                        if (nextIndex == null) return;
                        event.preventDefault();
                        const tabs = event.currentTarget.parentElement;
                        if (!tabs) return;
                        const next = tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
                        next?.focus();
                        next?.click();
                    }}
                >
                    {item === 'interval' ? intervalLabel : listLabel}
                </button>
            ))}
        </div>
    </div>
);

const RorTickListField = ({ unit, suffix }: { unit: TemperatureUnit; suffix: string }) => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const roastSettings = useRoastSettings();
    const show = (cPerMin: number) => Number(toDisplayRoR(cPerMin, unit).toFixed(6));
    const [draft, setDraft] = useState<{ value: string; unit: TemperatureUnit } | null>(null);
    const [error, setError] = useState(false);
    const invalid = error && draft?.unit === unit;
    return (
        <div className="grid gap-2">
            <label className={settingsOptionLabelCls} htmlFor="roast-ror-ticks">
                {tk('customRorTicks')} ({suffix})
            </label>
            <input
                id="roast-ror-ticks"
                type="text"
                maxLength={2000}
                value={
                    draft?.unit === unit ? draft.value : roastSettings.rorTicksC.map((value) => show(value)).join(', ')
                }
                placeholder="-5, 0, 5, 10, 15, 20"
                aria-invalid={invalid}
                aria-describedby="roast-ror-ticks-hint"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-xs text-primary outline-none focus:border-primary"
                onChange={(event) => setDraft({ value: event.currentTarget.value, unit })}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
                }}
                onBlur={(event) => {
                    if (draft?.unit !== unit) return;
                    const ticks = parseRorTicks(event.currentTarget.value, unit);
                    setError(ticks === null);
                    if (ticks === null) return;
                    updateRoastSettings({ rorTicksC: ticks });
                    setDraft(null);
                }}
            />
            <p
                id="roast-ror-ticks-hint"
                role={invalid ? 'alert' : undefined}
                className={`text-xs ${invalid ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}
            >
                {tk(invalid ? 'customRorTicksError' : 'customRorTicksDescription')}
            </p>
        </div>
    );
};

const RorLabelIntervalRow = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const unit = roastSettings.temperatureUnit;
    return (
        <SettingsOptionRow justify="between">
            <label className={settingsOptionLabelCls} htmlFor="roast-ror-label-interval">
                {t('settings.tabs.roast.rorLabelInterval')}
            </label>
            <NumberInput
                id="roast-ror-label-interval"
                integer
                value={Number(toDisplayRoR(roastSettings.rorLabelInterval, unit).toFixed(6))}
                onChange={(value) => updateRoastSettings({ rorLabelInterval: fromDisplayRoR(value, unit) })}
                min={1}
                max={toDisplayRoR(10000, unit)}
                suffix={rorUnitLabel(unit)}
            />
        </SettingsOptionRow>
    );
};

const HorizontalGridIntervalRow = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const roastSettings = useRoastSettings();
    const unit = roastSettings.temperatureUnit;
    const suffix = `°${unit}`;
    const show = (deltaC: number) => Number(toDisplayTempDelta(deltaC, unit).toFixed(6));
    const custom = roastSettings.horizontalGridMode === 'custom';
    return (
        <SettingsOptionRow justify="between" align="start">
            <label className={settingsOptionLabelCls} htmlFor={custom ? 'roast-horizontal-grid-interval' : undefined}>
                {tk('horizontalGridInterval')}
            </label>
            <div className="flex flex-col items-end gap-2">
                <Select
                    value={custom ? 'custom' : String(roastSettings.horizontalGridPresetInterval)}
                    onValueChange={(value) => {
                        if (value === 'custom') {
                            updateRoastSettings({ horizontalGridMode: 'custom' });
                            return;
                        }
                        if (!isPresetValue(HORIZONTAL_GRID_PRESETS, value)) return;
                        updateRoastSettings({
                            horizontalGridMode: 'preset',
                            horizontalGridPresetInterval: Number(value),
                        });
                    }}
                >
                    <SelectTrigger className="w-48" aria-label={tk('horizontalGridInterval')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {HORIZONTAL_GRID_PRESETS.map((value) => (
                            <SelectItem key={value} value={String(value)}>
                                {value === HORIZONTAL_GRID_PRESETS[0]
                                    ? t('settings.tabs.roast.axisTicksDefault', { value: `${show(value)}${suffix}` })
                                    : `${show(value)}${suffix}`}
                            </SelectItem>
                        ))}
                        <SelectItem value="custom">{tk('axisTicksCustom')}</SelectItem>
                    </SelectContent>
                </Select>
                {custom && (
                    <NumberInput
                        id="roast-horizontal-grid-interval"
                        integer
                        step={1}
                        value={Math.round(show(roastSettings.horizontalGridInterval))}
                        onChange={(value) =>
                            updateRoastSettings({
                                horizontalGridInterval: fromDisplayTempDelta(Math.round(value), unit),
                            })
                        }
                        min={1}
                        max={Math.round(show(100))}
                        suffix={suffix}
                    />
                )}
            </div>
        </SettingsOptionRow>
    );
};

const RorTickSection = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const roastSettings = useRoastSettings();
    const unit = roastSettings.temperatureUnit;
    return (
        <div className="grid gap-3">
            <TickModeTabs
                idPrefix="roast-ror-mode"
                mode={roastSettings.rorTickMode}
                label={tk('rorNumberMode')}
                intervalLabel={tk('tempTickInterval')}
                listLabel={tk('rorTickList')}
                onChange={(mode) => updateRoastSettings({ rorTickMode: mode })}
            />
            <div
                role="tabpanel"
                id="roast-ror-mode-panel"
                aria-labelledby={`roast-ror-mode-${roastSettings.rorTickMode}`}
            >
                {roastSettings.rorTickMode === 'list' ? (
                    <RorTickListField unit={unit} suffix={rorUnitLabel(unit)} />
                ) : (
                    <RorLabelIntervalRow />
                )}
            </div>
        </div>
    );
};

type SmoothingSetting = 'btSmoothing' | 'etSmoothing' | 'rorSmoothing' | 'etRorSmoothing';

const SMOOTHING_ROWS: { setting: SmoothingSetting; label: string }[] = [
    { setting: 'btSmoothing', label: 'BT' },
    { setting: 'etSmoothing', label: 'ET' },
    { setting: 'rorSmoothing', label: 'RoR' },
    { setting: 'etRorSmoothing', label: 'ET RoR' },
];

const smoothingRowCls = 'grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3';

const SmoothingControls = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const roastSettings = useRoastSettings();
    const [drafts, setDrafts] = useState<Partial<Record<SmoothingSetting, string>>>({});
    const commit = (setting: SmoothingSetting, value: string | undefined) => {
        if (value == null) return;
        setDrafts((prev) => {
            if (!(setting in prev)) return prev;
            const next = { ...prev };
            delete next[setting];
            return next;
        });
        const next = Number(value);
        if (value.trim() && Number.isFinite(next) && next !== roastSettings[setting]) {
            updateRoastSettings({ [setting]: next });
        }
    };
    const dirty = SMOOTHING_ROWS.some(({ setting }) => roastSettings[setting] !== 0);

    return (
        <SettingsSection group="sensors">
            <p className="m-0 text-xs leading-relaxed text-muted">{tk('smoothingHint')}</p>
            <div className="grid gap-2">
                <div className={`${smoothingRowCls} text-[12px] text-muted`}>
                    <span />
                    <span className="flex justify-between">
                        <span>{tk('btSmoothingFast')}</span>
                        <span>{tk('btSmoothingSmooth')}</span>
                    </span>
                    <span />
                </div>
                {SMOOTHING_ROWS.map(({ setting, label }) => {
                    const committed = roastSettings[setting];
                    const shown = drafts[setting] ?? String(committed);
                    return (
                        <div key={setting} className={smoothingRowCls}>
                            <span className="whitespace-nowrap text-[13px] font-medium text-primary">
                                <span aria-hidden="true">{label}</span>
                                <span className="sr-only">{tk(setting)}</span>
                            </span>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={shown === '' ? committed : Number(shown)}
                                aria-label={tk(setting)}
                                aria-valuetext={`${shown || committed} / 100`}
                                className="h-5 w-full accent-palette-black"
                                onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setDrafts((prev) => ({ ...prev, [setting]: value }));
                                }}
                                onPointerUp={(event) => commit(setting, event.currentTarget.value)}
                                onLostPointerCapture={(event) => commit(setting, event.currentTarget?.value)}
                                onPointerCancel={(event) => commit(setting, event.currentTarget?.value)}
                                onKeyUp={(event) => commit(setting, event.currentTarget.value)}
                                onBlur={(event) => commit(setting, event.currentTarget.value)}
                            />
                            <div className={numberInputWrapCls}>
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={shown}
                                    aria-label={tk(`${setting}Value`)}
                                    onChange={(event) => {
                                        const value = event.currentTarget.value;
                                        setDrafts((prev) => ({ ...prev, [setting]: value }));
                                    }}
                                    onBlur={(event) => commit(setting, event.currentTarget.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') commit(setting, event.currentTarget.value);
                                    }}
                                    className="w-14 bg-transparent text-right text-[13px] font-medium text-primary outline-none"
                                />
                                <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">/ 100</span>
                            </div>
                        </div>
                    );
                })}
                {dirty && (
                    <SurfaceButton
                        className="justify-self-start"
                        onClick={() => {
                            setDrafts({});
                            updateRoastSettings({
                                btSmoothing: 0,
                                etSmoothing: 0,
                                rorSmoothing: 0,
                                etRorSmoothing: 0,
                            });
                        }}
                    >
                        {tk('btSmoothingReset')}
                    </SurfaceButton>
                )}
            </div>
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
    const tempSuffix = `°${unit}`;
    const rorSuffix = rorUnitLabel(unit);
    const dispT = (celsius: number) => Math.round(toDisplayTemp(celsius, unit));
    const storeT = (display: number) => fromDisplayTemp(display, unit);
    const dispRoR = (cPerMin: number) => Number(toDisplayRoR(cPerMin, unit).toFixed(6));
    const storeRoR = (display: number) => fromDisplayRoR(display, unit);

    return (
        <div className="grid gap-8">
            <RoastingSettingsImport />
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
                <SettingsSection.Body>
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

            <SettingsSection group="bbp">
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
                    <SettingsOptionRow justify="between">
                        <label htmlFor="roast-auto-yellow" className="min-w-0 flex-1 cursor-pointer">
                            <div className={settingsOptionLabelCls}>{tk('yellowPoint')}</div>
                            <div id="roast-auto-yellow-description" className={settingsOptionDescCls}>
                                {tk('yellowPointDescription')}
                            </div>
                        </label>
                        <div className="flex shrink-0 items-center gap-4">
                            <NumberInput
                                value={dispT(roastSettings.yellowTempC)}
                                onChange={(v) => updateRoastSettings({ yellowTempC: storeT(v) })}
                                min={dispT(50)}
                                max={dispT(300)}
                                suffix={tempSuffix}
                            />
                            <input
                                id="roast-auto-yellow"
                                type="checkbox"
                                role="switch"
                                aria-checked={roastSettings.autoYellowEnabled}
                                aria-label={tk('yellowPoint')}
                                aria-describedby="roast-auto-yellow-description"
                                checked={roastSettings.autoYellowEnabled}
                                onChange={() =>
                                    updateRoastSettings({ autoYellowEnabled: !roastSettings.autoYellowEnabled })
                                }
                                className={settingsOptionSwitchCls}
                            />
                        </div>
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
            <EventButtonSection />

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

            <CurveStyleSection />

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
                        minId="roast-ror-min"
                        maxId="roast-ror-max"
                        minAriaLabel={tk('rorAxisMin')}
                        maxAriaLabel={tk('rorAxisMax')}
                        minVal={dispRoR(roastSettings.rorYMin)}
                        maxVal={dispRoR(roastSettings.rorYMax)}
                        onMinChange={(v) => updateRoastSettings({ rorYMin: storeRoR(v) })}
                        onMaxChange={(v) => updateRoastSettings({ rorYMax: storeRoR(v) })}
                        min={dispRoR(-100)}
                        max={dispRoR(300)}
                        suffix={rorSuffix}
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
                    <HorizontalGridIntervalRow />
                    <div className="grid gap-3 border-b border-border-subtle pb-3">
                        <TickModeTabs
                            idPrefix="roast-temp-mode"
                            mode={roastSettings.tempTickMode}
                            label={tk('tempNumberMode')}
                            intervalLabel={tk('tempTickInterval')}
                            listLabel={tk('tempTickList')}
                            onChange={(mode) => {
                                updateRoastSettings({ tempTickMode: mode });
                                setTicksDraft(null);
                                setTicksError(false);
                            }}
                        />
                        <div
                            role="tabpanel"
                            id="roast-temp-mode-panel"
                            aria-labelledby={`roast-temp-mode-${roastSettings.tempTickMode}`}
                        >
                            {roastSettings.tempTickMode === 'interval' ? (
                                <SettingsOptionRow justify="between">
                                    <label className={settingsOptionLabelCls} htmlFor="roast-temp-label-interval">
                                        {tk('tempLabelInterval')}
                                    </label>
                                    <NumberInput
                                        id="roast-temp-label-interval"
                                        value={roastSettings.tempLabelInterval}
                                        onChange={(value) => updateRoastSettings({ tempLabelInterval: value })}
                                        min={1}
                                        max={250000}
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
                                        onChange={(event) => setTicksDraft({ value: event.currentTarget.value, unit })}
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
                    <SettingsOptionRow justify="between" align="start">
                        <label
                            className={settingsOptionLabelCls}
                            htmlFor={roastSettings.timeTickCustom ? 'roast-timeTickIntervalSec-custom' : undefined}
                        >
                            {tk('timeTickInterval')}
                        </label>
                        <div className="flex flex-col items-end gap-2">
                            <Select
                                value={
                                    roastSettings.timeTickCustom ? 'custom' : String(roastSettings.timeTickPresetSec)
                                }
                                onValueChange={(value) => {
                                    if (value === 'custom') updateRoastSettings({ timeTickCustom: true });
                                    else if ([60, 30, 90, 120].includes(Number(value)))
                                        updateRoastSettings({
                                            timeTickCustom: false,
                                            timeTickPresetSec: Number(value),
                                        });
                                }}
                            >
                                <SelectTrigger className="w-48" aria-label={tk('timeTickInterval')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[60, 30, 90, 120].map((value) => (
                                        <SelectItem key={value} value={String(value)}>
                                            {value === 60
                                                ? t('settings.tabs.roast.axisTicksDefault', {
                                                      value: t('settings.tabs.roast.timeTickSeconds', { count: value }),
                                                  })
                                                : t('settings.tabs.roast.timeTickSeconds', { count: value })}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value="custom">{tk('axisTicksCustom')}</SelectItem>
                                </SelectContent>
                            </Select>
                            {roastSettings.timeTickCustom && (
                                <NumberInput
                                    id="roast-timeTickIntervalSec-custom"
                                    value={roastSettings.timeTickIntervalSec}
                                    onChange={(value) =>
                                        updateRoastSettings({ timeTickIntervalSec: Math.round(value) })
                                    }
                                    min={1}
                                    max={3600}
                                    suffix={tk('axisTickSeconds')}
                                />
                            )}
                        </div>
                    </SettingsOptionRow>
                    <RorTickSection />
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
            <SmoothingControls />
            <BatchTitleSettings />

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
