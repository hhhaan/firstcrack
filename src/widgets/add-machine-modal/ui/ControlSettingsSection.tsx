import {
    CONTROL_ROLES,
    PID_FORM_FIELDS,
    readFieldsForRole,
    type SerialPort,
    writeFieldsForRole,
} from '@entities/machine';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from './FormField';

type Props = {
    protocol: string;
    params: Record<string, string>;
    setParam: (key: string, value: string) => void;
    serialPorts: SerialPort[];
};

export const ControlSettingsSection = ({ protocol, params, setParam, serialPorts }: Props) => {
    const { t } = useTranslation();

    return (
        <div className="rounded-2xl p-5 border border-black/6 dark:border-[#585d61] bg-surface/50 dark:bg-surface-elevated grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1 mb-1">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal size={14} className="text-secondary dark:!text-[#a3a3a3]" />
                    <span className="text-[13px] font-semibold text-secondary">{t('addMachine.machineControl')}</span>
                </div>
                <p className="text-[11px] text-muted leading-relaxed m-0">{t('addMachine.machineControlHint')}</p>
            </div>

            {CONTROL_ROLES.map((role) => (
                <div key={role} className="col-span-2 grid grid-cols-2 gap-4">
                    <div className="col-span-2 text-[11px] font-semibold text-muted tracking-[0.04em] uppercase">
                        {t('addMachine.machineControlWrite', { role: role.toUpperCase() })}
                    </div>
                    {writeFieldsForRole(protocol, role).map((field) => (
                        <FormField
                            key={field.key}
                            field={field}
                            value={params[field.key] ?? ''}
                            onChange={(v) => setParam(field.key, v)}
                            serialPorts={serialPorts}
                            registryDefault=""
                        />
                    ))}
                    <div className="col-span-2 text-[11px] font-semibold text-muted tracking-[0.04em] uppercase">
                        {t('addMachine.machineControlRead', { role: role.toUpperCase() })}
                    </div>
                    {readFieldsForRole(protocol, role).map((field) => (
                        <FormField
                            key={field.key}
                            field={field}
                            value={params[field.key] ?? ''}
                            onChange={(v) => setParam(field.key, v)}
                            serialPorts={serialPorts}
                            registryDefault=""
                        />
                    ))}
                </div>
            ))}

            <div className="col-span-2 flex flex-col gap-1 mt-1">
                <span className="text-[11px] font-semibold text-muted tracking-[0.04em] uppercase">
                    {t('addMachine.pidGains')}
                </span>
                <p className="text-[11px] text-muted leading-relaxed m-0">{t('addMachine.pidGainsHint')}</p>
            </div>
            {PID_FORM_FIELDS.map((field) => (
                <FormField
                    key={field.key}
                    field={field}
                    value={params[field.key] ?? ''}
                    onChange={(v) => setParam(field.key, v)}
                    serialPorts={serialPorts}
                    registryDefault=""
                />
            ))}
        </div>
    );
};
