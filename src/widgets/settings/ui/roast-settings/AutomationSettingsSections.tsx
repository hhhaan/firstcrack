import {
    AUTO_DROP_START_MIN_MAX,
    DISCHARGE_ASSIST_SEC_MAX,
    fromDisplayTemp,
    toDisplayTemp,
    updateRoastSettings,
    useBbpStore,
    useRoastSettings,
} from '@features/active-roast';
import { FEATURE, useFeature } from '@shared/lib/features';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
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
export const AutomationSettingsSections = () => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    const canReplay = useFeature(FEATURE.machineReplay);
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const unit = roastSettings.temperatureUnit;
    const tempSuffix = `°${unit}`;
    const dispT = (celsius: number) => Math.round(toDisplayTemp(celsius, unit));
    const storeT = (display: number) => fromDisplayTemp(display, unit);
    const autoDropDescription = t('settings.tabs.roast.autoDropDescription', {
        minutes: roastSettings.autoDropStartMin,
    });
    return (
        <>
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

            <SettingsSection group="automation">
                <SettingsSection.Header title={tk('dischargeAssist')} description={tk('dischargeAssistDescription')} />
                <SettingsSection.Body className="grid gap-3">
                    <SettingsCheckRow
                        checked={roastSettings.dischargeAssistEnabled}
                        label={tk('dischargeAssistEnabled')}
                        onChange={() =>
                            updateRoastSettings({ dischargeAssistEnabled: !roastSettings.dischargeAssistEnabled })
                        }
                    />
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('dischargeAssistLead')}</div>
                            <div className={settingsOptionDescCls}>{tk('dischargeAssistLeadDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.dischargeAssistLeadSec}
                            onChange={(v) => updateRoastSettings({ dischargeAssistLeadSec: v })}
                            min={0}
                            max={DISCHARGE_ASSIST_SEC_MAX}
                            integer
                            suffix={tk('dischargeAssistSecUnit')}
                            disabled={!roastSettings.dischargeAssistEnabled}
                        />
                    </SettingsOptionRow>
                    <SettingsOptionRow justify="between">
                        <div>
                            <div className={settingsOptionLabelCls}>{tk('dischargeAssistClose')}</div>
                            <div className={settingsOptionDescCls}>{tk('dischargeAssistCloseDescription')}</div>
                        </div>
                        <NumberInput
                            value={roastSettings.dischargeAssistCloseSec}
                            onChange={(v) => updateRoastSettings({ dischargeAssistCloseSec: v })}
                            min={0}
                            max={DISCHARGE_ASSIST_SEC_MAX}
                            integer
                            suffix={tk('dischargeAssistSecUnit')}
                            disabled={!roastSettings.dischargeAssistEnabled}
                        />
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

            {canReplay && (
                <SettingsSection group="automation">
                    <SettingsSection.Header title={tk('replay')} description={tk('replayDescription')} />
                    <SettingsSection.Body>
                        <SettingsCheckRow
                            checked={roastSettings.replayOnCharge}
                            label={tk('replayOnCharge')}
                            description={tk('replayOnChargeDescription')}
                            onChange={() => updateRoastSettings({ replayOnCharge: !roastSettings.replayOnCharge })}
                        />
                    </SettingsSection.Body>
                </SettingsSection>
            )}

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
                    {/* 투입 후 BBP 이음은 기본 끔. 다시 넣을 때 주석 해제.
        <SettingsCheckRow
            checked={roastSettings.bbpJoinCharge}
            label={tk('bbpJoinCharge')}
            description={tk('bbpJoinChargeDescription')}
            onChange={() => updateRoastSettings({ bbpJoinCharge: !roastSettings.bbpJoinCharge })}
        />
        */}
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
        </>
    );
};
