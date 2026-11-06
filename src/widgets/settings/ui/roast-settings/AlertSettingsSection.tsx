import {
    ALERT_SOUND_KINDS,
    fromDisplayTemp,
    isAlertSoundKind,
    playAlertSound,
    toDisplayTemp,
    updateRoastSettings,
    useRoastSettings,
} from '@features/active-roast';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { Play } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
    SettingsCheckRow,
    SettingsOptionRow,
    settingsOptionDescCls,
    settingsOptionLabelCls,
    settingsOptionSwitchCls,
} from '../SettingsOptionRow';
import { SettingsSection } from '../SettingsSection';
import { NumberInput } from './RoastSettingsFields';

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
export const AlertSettingsSection = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const unit = roastSettings.temperatureUnit;
    const tempSuffix = `°${unit}`;
    const dispT = (celsius: number) => Math.round(toDisplayTemp(celsius, unit));
    const storeT = (display: number) => fromDisplayTemp(display, unit);
    return (
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
                <SettingsCheckRow
                    checked={roastSettings.alertSoundEnabled && roastSettings.alertTpEnabled}
                    disabled={!roastSettings.alertSoundEnabled}
                    label={tk('alertTp')}
                    description={tk('alertTpDescription')}
                    onChange={() => updateRoastSettings({ alertTpEnabled: !roastSettings.alertTpEnabled })}
                />
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
                    onEnabled={() => updateRoastSettings({ alertBeforeFcEnabled: !roastSettings.alertBeforeFcEnabled })}
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
    );
};
