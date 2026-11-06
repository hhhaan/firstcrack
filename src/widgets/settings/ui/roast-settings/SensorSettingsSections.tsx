import type { RorSpanSec } from '@features/active-roast';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useState } from 'react';
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

const smoothingRowCls = 'grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3';

export const SmoothingControls = () => {
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
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-main-bg">
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
