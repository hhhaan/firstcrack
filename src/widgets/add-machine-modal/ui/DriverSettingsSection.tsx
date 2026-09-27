import type { NetworkHost, RoasterDef, RoasterFormField, SerialPort } from '@entities/machine';
import { isRoasterFieldVisible, networkScanProtocol } from '@entities/machine';
import { Badge } from '@shared/ui/Badge';
import { openUrl } from '@tauri-apps/plugin-opener';
import { platform } from '@tauri-apps/plugin-os';
import { Info, Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from './FormField';

/** Official Phidget22 runtime — same URLs as docs/machines/phidget.md */
const PHIDGET22_INSTALL: Record<'windows' | 'macos', string> = {
    windows: 'https://www.phidgets.com/downloads/phidget22/libraries/windows/Phidget22-x64.exe',
    macos: 'https://www.phidgets.com/downloads/phidget22/libraries/macos/Phidget22.dmg',
};

const phidgetInstallUrl = (): string => {
    try {
        return platform() === 'windows' ? PHIDGET22_INSTALL.windows : PHIDGET22_INSTALL.macos;
    } catch {
        return PHIDGET22_INSTALL.macos;
    }
};

type Props = {
    selectedDef: RoasterDef | null;
    isCustom: boolean;
    params: Record<string, string>;
    setParam: (key: string, value: string) => void;
    serialPorts: SerialPort[];
    onRefreshPorts?: () => void;
    networkHosts: NetworkHost[];
    scanningNetwork: boolean;
    scannedNetworkOnce: boolean;
    onScanNetwork?: (protocol: string) => void;
    showAddressMap: boolean;
    addressFields: RoasterFormField[];
};

export const DriverSettingsSection = ({
    selectedDef,
    isCustom,
    params,
    setParam,
    serialPorts,
    onRefreshPorts,
    networkHosts,
    scanningNetwork,
    scannedNetworkOnce,
    onScanNetwork,
    showAddressMap,
    addressFields,
}: Props) => {
    const { t } = useTranslation();
    const protocol = selectedDef?.protocol;
    const scanKey = protocol ? networkScanProtocol(protocol) : null;
    const handleScanNetwork = scanKey && onScanNetwork && protocol ? () => onScanNetwork(protocol) : undefined;

    return (
        <>
            {/* Driver settings: known model capabilities */}
            {selectedDef && !isCustom && (
                <div className="bg-surface-warm-solid rounded-[14px] p-3.5 shadow-(--shadow-warm) flex gap-4 flex-wrap">
                    <div className="flex gap-1.5 flex-wrap">
                        <Badge tone="soft" className="px-2.5 font-semibold">
                            {selectedDef.protocol.toUpperCase()}
                        </Badge>
                        {selectedDef.capabilities.map((cap) => (
                            <Badge key={cap} tone="soft" className="px-2.5 font-semibold">
                                {cap}
                            </Badge>
                        ))}
                        {selectedDef.pid && (
                            <Badge tone="soft" className="px-2.5 font-semibold">
                                PID Kp={selectedDef.pid.Kp} Ki={selectedDef.pid.Ki} Kd={selectedDef.pid.Kd}
                            </Badge>
                        )}
                    </div>
                    {selectedDef.models.length > 0 && (
                        <div className="text-xs text-muted w-full">
                            {[...selectedDef.models].sort((a, b) => a.localeCompare(b)).join(' · ')}
                        </div>
                    )}
                </div>
            )}

            {/* Driver settings: custom protocol capabilities */}
            {selectedDef && isCustom && (
                <div className="bg-surface-warm-solid rounded-[14px] p-3.5 shadow-(--shadow-warm) flex gap-1.5 flex-wrap">
                    <Badge tone="soft" className="px-2.5 font-semibold">
                        {selectedDef.protocol.toUpperCase()}
                    </Badge>
                    {selectedDef.capabilities.map((cap) => (
                        <Badge key={cap} tone="soft" className="px-2.5 font-semibold">
                            {cap}
                        </Badge>
                    ))}
                </div>
            )}

            {/* Driver settings: phidget notice */}
            {selectedDef?.protocol === 'phidget' && (
                <div className="flex items-start gap-2.5 bg-[rgba(59,130,246,0.07)] dark:bg-blue-500/10 border border-[rgba(59,130,246,0.15)] dark:border-blue-500/20 rounded-xl px-3.5 py-[11px]">
                    <Info size={14} className="text-blue-500 dark:!text-blue-400 shrink-0 mt-px" />
                    <span className="text-[12px] text-secondary leading-relaxed">
                        {t('addMachine.phidgetDriverNotice')}{' '}
                        <button
                            type="button"
                            onClick={() => {
                                void openUrl(phidgetInstallUrl());
                            }}
                            className="text-blue-500 dark:!text-blue-400 underline cursor-pointer bg-transparent border-none p-0 text-[12px] font-body"
                        >
                            {t('addMachine.phidgetDriverLink')}
                        </button>
                    </span>
                </div>
            )}

            {/* Driver settings: connection form fields */}
            {selectedDef && selectedDef.form_fields.length > 0 && (
                <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
                    <div className="col-span-2 flex items-center gap-2 mb-1">
                        <Radio size={14} className="text-secondary dark:!text-[#a3a3a3]" />
                        <span className="text-[13px] font-semibold text-secondary">
                            {t('addMachine.connectionSettings')}
                        </span>
                    </div>
                    {selectedDef.form_fields
                        .filter((f) => isRoasterFieldVisible(f.key, params.mode))
                        .map((field) => (
                            <FormField
                                key={field.key}
                                field={field}
                                value={params[field.key] ?? ''}
                                onChange={(v) => setParam(field.key, v)}
                                serialPorts={serialPorts}
                                registryDefault={(selectedDef?.default_params[field.key] as string) ?? ''}
                                onRefreshPorts={onRefreshPorts}
                                networkHosts={networkHosts}
                                scanningNetwork={scanningNetwork}
                                scannedNetworkOnce={scannedNetworkOnce}
                                onScanNetwork={handleScanNetwork}
                            />
                        ))}
                </div>
            )}

            {/* Driver settings: address map */}
            {addressFields.length > 0 && (
                <details
                    open={showAddressMap}
                    className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated"
                >
                    <summary className="cursor-pointer text-[13px] font-semibold text-secondary">
                        {t('addMachine.addressMap')}
                    </summary>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                        <p className="col-span-2 text-[11px] text-muted leading-relaxed m-0">
                            {t(showAddressMap ? 'addMachine.addressMapHint' : 'addMachine.supportedAddressHint')}
                        </p>
                        {addressFields.map((field) => (
                            <FormField
                                key={field.key}
                                field={field}
                                value={params[field.key] ?? ''}
                                onChange={(v) => setParam(field.key, v)}
                                serialPorts={serialPorts}
                                registryDefault=""
                                onRefreshPorts={onRefreshPorts}
                            />
                        ))}
                    </div>
                </details>
            )}
        </>
    );
};
