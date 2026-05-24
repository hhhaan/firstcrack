import {
    useRoastSettings,
    updateRoastSettings,
    type PollIntervalMs,
    type RorSpanSec,
    type TemperatureUnit,
} from '@features/active-roast';

const temperatureOptions: TemperatureUnit[] = ['C', 'F'];
const pollOptions: PollIntervalMs[] = [250, 500, 1000];
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
    { key: 'showControlChart' as const, label: 'Control Chart', description: 'Drum / Heat / Fan bottom chart (fullscreen only)' },
];

const NumberInput = ({
    value,
    onChange,
    min,
    max,
    step = 1,
    suffix,
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
}) => (
    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white">
        <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onChange(v);
            }}
            className="w-14 bg-transparent text-[13px] font-medium text-[#111827] text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="text-[12px] text-[#6B7280]">{suffix}</span>}
    </div>
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
        <span className="text-[13px] text-[#374151] shrink-0">{label}</span>
        <div className="flex items-center gap-2">
            <NumberInput value={minVal} onChange={onMinChange} min={min} max={maxVal - 1} suffix={suffix} />
            <span className="text-[12px] text-[#9CA3AF]">–</span>
            <NumberInput value={maxVal} onChange={onMaxChange} min={minVal + 1} max={max} suffix={suffix} />
        </div>
    </div>
);

const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <section className="bg-white border border-[#E5E7EB] rounded-xl p-5">{children}</section>
);

const CheckboxRow = ({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) => (
    <label className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 accent-[#111827]" />
        <span className="text-[14px] font-medium text-[#111827]">{label}</span>
    </label>
);

export const RoastSettingsTab = () => {
    const roastSettings = useRoastSettings();

    return (
        <>
            <SectionCard>
                <div className="mb-4">
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">Temperature Unit</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">Display temperatures in Celsius or Fahrenheit.</p>
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
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">Update Rate</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">
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
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">RoR Span</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">
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
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">Data Visibility</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">
                        Choose which data series are displayed on the roasting chart.
                    </p>
                </div>
                <div className="grid gap-1.5">
                    {visibilityOptions.map(({ key, label, description }) => (
                        <label
                            key={key}
                            className="flex items-start gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={roastSettings[key]}
                                onChange={(e) => updateRoastSettings({ [key]: e.target.checked })}
                                className="mt-0.5 shrink-0 accent-[#111827]"
                            />
                            <div>
                                <div className="text-[14px] font-medium text-[#111827]">{label}</div>
                                <div className="text-[12px] text-[#6B7280] mt-0.5">{description}</div>
                            </div>
                        </label>
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-4">
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">Axis Range</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">
                        Set the visible range for the temperature and RoR axes.
                    </p>
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
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">Phase Temperatures</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">
                        BT thresholds for automatic event marking on the chart.
                    </p>
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
                        <div
                            key={key}
                            className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white"
                        >
                            <div>
                                <div className="text-[14px] font-medium text-[#111827]">{label}</div>
                                <div className="text-[12px] text-[#6B7280] mt-0.5">{description}</div>
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
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0 mb-0.5">Auto Charge Detection</h4>
                    <p className="text-[13px] text-[#6B7280] m-0">
                        Charge is triggered when BT drops by this amount within the detection window.
                    </p>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white">
                    <div>
                        <div className="text-[14px] font-medium text-[#111827]">Drop Threshold</div>
                        <div className="text-[12px] text-[#6B7280] mt-0.5">Minimum BT drop to detect bean charge</div>
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
