import type { RorSpanSec } from '@features/active-roast';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast';
import { cn } from '@shared/lib/cn';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from '../SettingsOptionRow';
import { SettingsSection } from '../SettingsSection';

const rorOptions: RorSpanSec[] = [15, 30, 60];
type SmoothingSetting = 'btSmoothing' | 'etSmoothing' | 'rorSmoothing' | 'etRorSmoothing';

const SMOOTHING_ROWS: { setting: SmoothingSetting; label: string }[] = [
    { setting: 'btSmoothing', label: 'BT' },
    { setting: 'etSmoothing', label: 'ET' },
    { setting: 'rorSmoothing', label: 'RoR' },
    { setting: 'etRorSmoothing', label: 'ET RoR' },
];

/** Stored strengths stay 0–100. These three are the only choices the screen writes. */
const SMOOTHING_LEVELS = [
    { value: 0, key: 'smoothingNone' },
    { value: 50, key: 'smoothingMedium' },
    { value: 100, key: 'smoothingHigh' },
] as const;

/** Legacy values highlight the nearest level. 25 and 75 land on the higher level. */
const smoothingLevel = (strength: number): (typeof SMOOTHING_LEVELS)[number]['value'] => {
    if (strength < 25) return 0;
    if (strength < 75) return 50;
    return 100;
};

export const SmoothingControls = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const roastSettings = useRoastSettings();
    const dirty = SMOOTHING_ROWS.some(({ setting }) => roastSettings[setting] !== 0);
    const select = (setting: SmoothingSetting, value: (typeof SMOOTHING_LEVELS)[number]['value']) => {
        if (roastSettings[setting] !== value) updateRoastSettings({ [setting]: value });
    };

    return (
        <SettingsSection group="sensors">
            <p className="m-0 text-xs leading-relaxed text-muted">{tk('smoothingHint')}</p>
            <div className="grid gap-2">
                {SMOOTHING_ROWS.map(({ setting, label }) => {
                    const selected = smoothingLevel(roastSettings[setting]);
                    return (
                        <div key={setting} className="flex flex-wrap items-center gap-x-8 gap-y-2">
                            <span
                                className="w-16 shrink-0 whitespace-nowrap text-[13px] font-medium text-primary"
                                aria-hidden="true"
                            >
                                {label}
                            </span>
                            <div
                                role="radiogroup"
                                aria-label={tk(setting)}
                                className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-main-bg p-0.5"
                            >
                                {SMOOTHING_LEVELS.map((level) => {
                                    const checked = selected === level.value;
                                    return (
                                        <label
                                            key={level.value}
                                            className={cn(
                                                'inline-flex h-8 cursor-pointer items-center justify-center rounded-md border px-3 text-[13px] font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary',
                                                checked
                                                    ? 'border-action bg-action text-on-action'
                                                    : 'border-transparent text-secondary hover:bg-surface',
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                className="sr-only"
                                                name={setting}
                                                value={level.value}
                                                checked={checked}
                                                onChange={() => select(setting, level.value)}
                                                onClick={() => select(setting, level.value)}
                                            />
                                            {tk(level.key)}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
                {dirty && (
                    <SurfaceButton
                        className="justify-self-start"
                        onClick={() =>
                            updateRoastSettings({
                                btSmoothing: 0,
                                etSmoothing: 0,
                                rorSmoothing: 0,
                                etRorSmoothing: 0,
                            })
                        }
                    >
                        {tk('btSmoothingReset')}
                    </SurfaceButton>
                )}
            </div>
        </SettingsSection>
    );
};
export const RorSpanSection = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);

    return (
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
    );
};
