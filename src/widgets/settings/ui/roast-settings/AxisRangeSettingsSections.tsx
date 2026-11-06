import {
    fromDisplayRoR,
    rorUnitLabel,
    TIME_RANGE_MIN_DEFAULT,
    TIME_RANGE_PRESET_MIN,
    toDisplayRoR,
    updateRoastSettings,
    useRoastSettings,
} from '@features/active-roast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { useTranslation } from 'react-i18next';
import {
    SettingsCheckRow,
    SettingsOptionRow,
    settingsOptionDescCls,
    settingsOptionLabelCls,
} from '../SettingsOptionRow';
import { SettingsSection } from '../SettingsSection';
import { NumberInput, RoastCheckRows } from './RoastSettingsFields';

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
export const AxisRangeSettingsSection = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const unit = roastSettings.temperatureUnit;
    const rorSuffix = rorUnitLabel(unit);
    const dispRoR = (cPerMin: number) => Number(toDisplayRoR(cPerMin, unit).toFixed(6));
    const storeRoR = (display: number) => fromDisplayRoR(display, unit);
    return (
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
    );
};
export const ControlChartSettingsSection = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);

    return (
        <SettingsSection group="axes">
            <SettingsSection.Header title={tk('controlChart')} description={tk('controlChartDescription')} />
            <SettingsSection.Body className="grid gap-3">
                <SettingsCheckRow
                    checked={roastSettings.mergeControlChart}
                    onChange={() => updateRoastSettings({ mergeControlChart: !roastSettings.mergeControlChart })}
                    label={tk('mergeControlChart')}
                    description={tk('mergeControlChartDescription')}
                />
                <div className="grid gap-1.5">
                    <RoastCheckRows options={controlSeriesOptions} />
                </div>
                {!roastSettings.mergeControlChart && (
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
                )}
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
    );
};
