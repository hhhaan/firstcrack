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
];

const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
        {children}
    </section>
);

const PillButton = ({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`border-none rounded-full px-5 py-2.25 cursor-pointer text-[13px] font-semibold ${
            active ? 'bg-primary text-white shadow-card' : 'bg-[rgba(255,255,255,0.88)] text-secondary shadow-inset'
        }`}
    >
        {label}
    </button>
);

export const RoastSettingsTab = () => {
    const roastSettings = useRoastSettings();

    return (
        <>
            <SectionCard>
                <div className="mb-3.5">
                    <h4 className="text-base font-semibold text-primary mb-1">Temperature Unit</h4>
                    <p className="text-[13px] text-secondary">Display temperatures in Celsius or Fahrenheit.</p>
                </div>
                <div className="flex gap-2">
                    {temperatureOptions.map((u) => (
                        <PillButton
                            key={u}
                            active={roastSettings.temperatureUnit === u}
                            label={`°${u}`}
                            onClick={() => updateRoastSettings({ temperatureUnit: u })}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-3.5">
                    <h4 className="text-base font-semibold text-primary mb-1">Update Rate</h4>
                    <p className="text-[13px] text-secondary">
                        How often to poll the machine for temperature data during a live session.
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {pollOptions.map((ms) => (
                        <PillButton
                            key={ms}
                            active={roastSettings.pollIntervalMs === ms}
                            label={ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                            onClick={() => updateRoastSettings({ pollIntervalMs: ms })}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-3.5">
                    <h4 className="text-base font-semibold text-primary mb-1">RoR Span</h4>
                    <p className="text-[13px] text-secondary">
                        Time window for Rate of Rise calculation. Shorter spans react faster; longer spans are smoother.
                    </p>
                </div>
                <div className="flex gap-2">
                    {rorOptions.map((sec) => (
                        <PillButton
                            key={sec}
                            active={roastSettings.rorSpanSec === sec}
                            label={`${sec}s`}
                            onClick={() => updateRoastSettings({ rorSpanSec: sec })}
                        />
                    ))}
                </div>
            </SectionCard>

            <SectionCard>
                <div className="mb-3.5">
                    <h4 className="text-base font-semibold text-primary mb-1">Data Visibility</h4>
                    <p className="text-[13px] text-secondary">
                        Choose which data series are displayed on the roasting chart.
                    </p>
                </div>
                <div className="grid gap-2.5">
                    {visibilityOptions.map(({ key, label, description }) => (
                        <label
                            key={key}
                            className="flex items-start gap-3 px-3.5 py-3 rounded-[14px] bg-[rgba(255,255,255,0.88)] shadow-inset cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={roastSettings[key]}
                                onChange={(e) => updateRoastSettings({ [key]: e.target.checked })}
                                className="accent-[#6f4e37] mt-0.5 shrink-0"
                            />
                            <div>
                                <div className="text-[13px] font-medium text-primary">{label}</div>
                                <div className="text-xs text-muted mt-0.5">{description}</div>
                            </div>
                        </label>
                    ))}
                </div>
            </SectionCard>
        </>
    );
};
