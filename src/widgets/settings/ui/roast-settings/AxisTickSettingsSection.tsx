import {
    fromDisplayRoR,
    fromDisplayTempDelta,
    rorUnitLabel,
    type TemperatureUnit,
    toDisplayRoR,
    toDisplayTemp,
    toDisplayTempDelta,
    updateRoastSettings,
    useRoastSettings,
} from '@features/active-roast';
import { parseRorTicks, parseTemperatureTicks } from '@features/active-roast/lib/temperature';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionLabelCls } from '../SettingsOptionRow';
import { SettingsSection } from '../SettingsSection';
import { NumberInput } from './RoastSettingsFields';

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
export const AxisTickSettingsSection = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const [ticksDraft, setTicksDraft] = useState<{ value: string; unit: TemperatureUnit } | null>(null);
    const [ticksError, setTicksError] = useState(false);
    const unit = roastSettings.temperatureUnit;
    const ticksInvalid = ticksError && ticksDraft?.unit === unit;
    const tempSuffix = `°${unit}`;
    return (
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
                            value={roastSettings.timeTickCustom ? 'custom' : String(roastSettings.timeTickPresetSec)}
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
                                onChange={(value) => updateRoastSettings({ timeTickIntervalSec: Math.round(value) })}
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
    );
};
