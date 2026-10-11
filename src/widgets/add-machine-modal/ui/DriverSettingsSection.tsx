import type { NetworkHost, RoasterDef, RoasterFormField, SerialPort } from '@entities/machine';
import { isRoasterFieldVisible, networkScanProtocol } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { Badge } from '@shared/ui/Badge';
import { openUrl } from '@tauri-apps/plugin-opener';
import { platform } from '@tauri-apps/plugin-os';
import { Info, Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from './FormField';

const PRIMARY_ADDRESS_KEYS = new Set([
    'bt_register',
    'bt_func',
    'bt_unit_id',
    'bt_db',
    'bt_offset',
    'bt_type',
    'et_register',
    'et_func',
    'et_unit_id',
    'et_db',
    'et_offset',
    'et_type',
]);

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
    const renderAddressField = (field: RoasterFormField) => (
        <FormField
            key={field.key}
            field={field}
            value={params[field.key] ?? ''}
            onChange={(v) => setParam(field.key, v)}
            serialPorts={serialPorts}
            registryDefault=""
            onRefreshPorts={onRefreshPorts}
        />
    );

    return (
        <div className={cn('grid gap-4', addressFields.length > 0 && 'md:grid-cols-2')}>
            {/* Driver settings: known model capabilities */}
            {selectedDef && !isCustom && (
                <div className="flex flex-wrap gap-2 md:col-span-full">
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
            {selectedDef && isCustom && selectedDef.capabilities.length > 0 && (
                <div className="flex gap-1.5 flex-wrap md:col-span-full">
                    {selectedDef.capabilities.map((cap) => (
                        <Badge key={cap} tone="soft" className="px-2.5 font-semibold">
                            {cap}
                        </Badge>
                    ))}
                </div>
            )}

            {/* Driver settings: phidget notice */}
            {selectedDef?.protocol === 'phidget' && (
                <div className="flex items-start gap-2.5 bg-[rgba(59,130,246,0.07)] dark:bg-blue-500/10 border border-[rgba(59,130,246,0.15)] dark:border-blue-500/20 rounded-xl px-3.5 py-[11px] md:col-span-full">
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
                <section
                    className="min-w-0 self-start rounded-xl p-4 border border-border bg-surface/40 grid grid-cols-2 gap-3"
                    aria-labelledby="machine-connection-heading"
                >
                    <h3
                        id="machine-connection-heading"
                        className="col-span-2 flex items-center gap-2 m-0 pb-3 border-b border-border-subtle"
                    >
                        <Radio size={14} className="text-secondary" />
                        <span className="text-[13px] font-semibold text-primary">
                            {t('addMachine.connectionSettings')}
                        </span>
                    </h3>
                    {selectedDef.form_fields
                        .filter((f) => isRoasterFieldVisible(f.key, params.mode))
                        .map((field) => (
                            <FormField
                                key={field.key}
                                field={field}
                                value={params[field.key] ?? ''}
                                onChange={(v) => setParam(field.key, v)}
                                serialPorts={serialPorts}
                                registryDefault={(selectedDef.default_params[field.key] as string | undefined) ?? ''}
                                onRefreshPorts={onRefreshPorts}
                                networkHosts={networkHosts}
                                scanningNetwork={scanningNetwork}
                                scannedNetworkOnce={scannedNetworkOnce}
                                onScanNetwork={handleScanNetwork}
                            />
                        ))}
                </section>
            )}

            {/* Driver settings: address map */}
            {addressFields.length > 0 && (
                <details
                    open={showAddressMap}
                    className="min-w-0 self-start rounded-xl p-4 border border-border bg-main-bg"
                >
                    <summary className="cursor-pointer text-[13px] font-semibold text-primary">
                        {t(showAddressMap ? 'addMachine.addressMap' : 'addMachine.supportedAddressMap')}
                    </summary>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                        <p className="col-span-2 text-[11px] text-muted leading-relaxed m-0">
                            {t(showAddressMap ? 'addMachine.addressMapHint' : 'addMachine.supportedAddressHint')}
                        </p>
                        {showAddressMap ? (
                            <>
                                {(['bt', 'et'] as const).map((channel) => (
                                    <fieldset key={channel} className="min-w-0 m-0 p-0 border-0 space-y-3">
                                        <legend className="mb-3 flex items-center gap-2 text-xs font-semibold text-primary">
                                            <span
                                                aria-hidden
                                                className={cn(
                                                    'h-1.5 w-1.5 rounded-full',
                                                    channel === 'bt' ? 'bg-sensor-bt' : 'bg-sensor-et',
                                                )}
                                            />
                                            {channel.toUpperCase()}
                                            <span className="text-[11px] font-normal text-muted">
                                                {t(
                                                    channel === 'bt'
                                                        ? 'machines.temperature.bean'
                                                        : 'machines.temperature.environment',
                                                )}
                                            </span>
                                        </legend>
                                        {addressFields
                                            .filter(
                                                (field) =>
                                                    field.key.startsWith(`${channel}_`) &&
                                                    PRIMARY_ADDRESS_KEYS.has(field.key),
                                            )
                                            .map(renderAddressField)}
                                    </fieldset>
                                ))}
                                <details className="col-span-2 border-t border-border-subtle pt-3">
                                    <summary className="cursor-pointer text-xs font-medium text-secondary">
                                        {t('addMachine.advancedSettings')}
                                    </summary>
                                    <div className="grid grid-cols-2 gap-3 mt-3">
                                        {(['bt', 'et'] as const).map((channel) => (
                                            <div key={channel} className="min-w-0 space-y-3">
                                                {addressFields
                                                    .filter(
                                                        (field) =>
                                                            field.key.startsWith(`${channel}_`) &&
                                                            !PRIMARY_ADDRESS_KEYS.has(field.key),
                                                    )
                                                    .map(renderAddressField)}
                                            </div>
                                        ))}
                                        {addressFields
                                            .filter(
                                                (field) => !field.key.startsWith('bt_') && !field.key.startsWith('et_'),
                                            )
                                            .map(renderAddressField)}
                                    </div>
                                </details>
                            </>
                        ) : (
                            addressFields.map(renderAddressField)
                        )}
                    </div>
                </details>
            )}
        </div>
    );
};
