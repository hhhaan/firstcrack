import {
    type PollIntervalMs,
    type RorSpanSec,
    type TemperatureUnit,
    updateRoastSettings,
    useRoastSettings,
} from '@features/active-roast';
import { SectionCard } from '@shared/ui/SectionCard';
import { useEffect, useState } from 'react';
import { NumericFormat } from 'react-number-format';

const temperatureOptions: TemperatureUnit[] = ['C', 'F'];
const pollOptions: PollIntervalMs[] = [500, 1000];
const rorOptions: RorSpanSec[] = [15, 30, 60];

const visibilityOptions = [
    { key: 'showET' as const, label: 'Env Temp (ET)', description: 'Blue dashed line on the temperature chart' },
    {
        key: 'showTargetCurve' as const,
        label: 'Target Curve',
        description: 'Faded reference line for the target BT profile',
    },
    {
        key: 'showRoRChart' as const,
        label: 'RoR Chart',
        description: 'Rate of Rise sub-chart below the temperature curve',
    },
    { key: 'showRoRET' as const, label: 'ET Rate of Rise', description: 'ET RoR line in the RoR sub-chart' },
    {
        key: 'showControlChart' as const,
        label: 'Control Chart',
        description: 'Drum / Heat / Fan bottom chart (fullscreen only)',
    },
    {
        key: 'showPhaseBar' as const,
        label: 'Phase Bar',
        description: 'Bottom strip showing Drying / Maillard / Development with duration and percentage',
    },
];

const sectionTitleCls = 'text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0 mb-0.5';
const sectionDescCls = 'text-[13px] text-[#6B7280] dark:text-[#999] m-0';
const optionRowCls =
    'flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] cursor-pointer';
const optionRowStaticCls =
    'flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21]';
const checkboxCls = 'w-4 h-4 accent-[#111827] dark:accent-[#F2F2F2]';
const optionLabelCls = 'text-[14px] font-medium text-[#111827] dark:text-[#e5e5e5]';
const optionDescCls = 'text-[12px] text-[#6B7280] dark:text-[#999] mt-0.5';
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

const CheckboxRow = ({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) => (
    <label className={optionRowCls}>
        <input type="checkbox" checked={checked} onChange={onChange} className={checkboxCls} />
        <span className={optionLabelCls}>{label}</span>
    </label>
);

export const RoastSettingsTab = () => {
    const roastSettings = useRoastSettings();

    return (
        <>
            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>Temperature Unit</h4>
                    <p className={sectionDescCls}>Display temperatures in Celsius or Fahrenheit.</p>
                </div>
                <div className="grid gap-1.5">
                    {temperatureOptions.map((u) => (
                        <CheckboxRow
                            key={u}
                            checked={roastSettings.temperatureUnit === u}
                            label={`°${u}`}
                            onChange={() => updateRoastSettings({ temperatureUnit: u })}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>Update Rate</h4>
                    <p className={sectionDescCls}>
                        How often to poll the machine for temperature data during a live session.
                    </p>
                </div>
                <div className="grid gap-1.5">
                    {pollOptions.map((ms) => (
                        <CheckboxRow
                            key={ms}
                            checked={roastSettings.pollIntervalMs === ms}
                            label={ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                            onChange={() => updateRoastSettings({ pollIntervalMs: ms })}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>RoR Span</h4>
                    <p className={sectionDescCls}>
                        Time window for Rate of Rise calculation. Shorter spans react faster; longer spans are smoother.
                    </p>
                </div>
                <div className="grid gap-1.5">
                    {rorOptions.map((sec) => (
                        <CheckboxRow
                            key={sec}
                            checked={roastSettings.rorSpanSec === sec}
                            label={`${sec}s`}
                            onChange={() => updateRoastSettings({ rorSpanSec: sec })}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>Data Visibility</h4>
                    <p className={sectionDescCls}>Choose which data series are displayed on the roasting chart.</p>
                </div>
                <div className="grid gap-1.5">
                    {visibilityOptions.map(({ key, label, description }) => (
                        <label key={key} className={`${optionRowCls} items-start`}>
                            <input
                                type="checkbox"
                                checked={roastSettings[key]}
                                onChange={(e) => updateRoastSettings({ [key]: e.target.checked })}
                                className={`mt-0.5 shrink-0 ${checkboxCls}`}
                            />
                            <div>
                                <div className={optionLabelCls}>{label}</div>
                                <div className={optionDescCls}>{description}</div>
                            </div>
                        </label>
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>Axis Range</h4>
                    <p className={sectionDescCls}>Set the visible range for the temperature and RoR axes.</p>
                </div>
                <div className="grid gap-1.5">
                    <RangeRow
                        label="Temp"
                        minVal={roastSettings.tempMinC}
                        maxVal={roastSettings.tempMaxC}
                        onMinChange={(v) => updateRoastSettings({ tempMinC: v })}
                        onMaxChange={(v) => updateRoastSettings({ tempMaxC: v })}
                        min={0}
                        max={500}
                        suffix="°C"
                    />
                    <RangeRow
                        label="RoR"
                        minVal={roastSettings.rorYMin}
                        maxVal={roastSettings.rorYMax}
                        onMinChange={(v) => updateRoastSettings({ rorYMin: v })}
                        onMaxChange={(v) => updateRoastSettings({ rorYMax: v })}
                        min={-30}
                        max={100}
                        suffix="°/min"
                    />
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>Phase Temperatures</h4>
                    <p className={sectionDescCls}>BT thresholds for automatic event marking on the chart.</p>
                </div>
                <div className="grid gap-1.5">
                    {[
                        {
                            label: 'Yellow Point',
                            key: 'yellowTempC' as const,
                            description: 'BT at which Yellow is auto-marked',
                        },
                        {
                            label: 'FC Start',
                            key: 'fcStartTempC' as const,
                            description: 'BT at which First Crack is auto-marked',
                        },
                    ].map(({ label, key, description }) => (
                        <div key={key} className={optionRowStaticCls}>
                            <div>
                                <div className={optionLabelCls}>{label}</div>
                                <div className={optionDescCls}>{description}</div>
                            </div>
                            <NumberInput
                                value={roastSettings[key]}
                                onChange={(v) => updateRoastSettings({ [key]: v })}
                                min={50}
                                max={300}
                                suffix="°C"
                            />
                        </div>
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className={sectionTitleCls}>Auto Charge Detection</h4>
                    <p className={sectionDescCls}>
                        Charge is triggered when BT drops by this amount within the detection window.
                    </p>
                </div>
                <div className={optionRowStaticCls}>
                    <div>
                        <div className={optionLabelCls}>Drop Threshold</div>
                        <div className={optionDescCls}>Minimum BT drop to detect bean charge</div>
                    </div>
                    <NumberInput
                        value={roastSettings.autoChargeDropC}
                        onChange={(v) => updateRoastSettings({ autoChargeDropC: v })}
                        min={1}
                        max={30}
                        suffix="°C"
                    />
                </div>
            </SectionCard>
        </>
    );
};
