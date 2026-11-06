import {
    type PollIntervalMs,
    type TemperatureUnit,
    updateRoastSettings,
    useEffectivePollIntervalMs,
    useRoastSettings,
} from '@features/active-roast';
import { FEATURE, useFeature } from '@shared/lib/features';
import { Badge } from '@shared/ui/Badge';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from '../SettingsOptionRow';
import { SettingsSection } from '../SettingsSection';

const temperatureOptions: TemperatureUnit[] = ['C', 'F'];
const pollOptions: PollIntervalMs[] = [500, 1000];
export const TemperatureUnitSection = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);

    return (
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
    );
};
export const PollingSection = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const canFastPoll = useFeature(FEATURE.fastPolling);
    const effectivePollMs = useEffectivePollIntervalMs();
    const [showPollUpgradeHint, setShowPollUpgradeHint] = useState(false);
    return (
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
    );
};
