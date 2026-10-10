import type { Machine, RoasterFormField } from '@entities/machine';
import { addressFormFieldsForProtocol, buildProtocolRoasterDef } from '@entities/machine';
import { useTranslation } from 'react-i18next';

const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const ConnectionFields = ({
    params,
    fields,
    prefix = '',
}: {
    params: Record<string, unknown>;
    fields: RoasterFormField[];
    prefix?: string;
}) => (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(params)
            .filter(([, value]) => value !== '' && value != null && typeof value !== 'object')
            .filter(([key]) => key !== 'role')
            .map(([key, value]) => {
                const field = fields.find((field) => field.key === `${prefix}${key}`);
                const display =
                    field?.options?.find((option) => option.value === String(value))?.label ?? String(value);
                return (
                    <div key={key} className="min-w-0 px-2.5 py-2 rounded-lg bg-main-bg">
                        <dt className="text-[11px] text-muted mb-1">
                            {field?.label.replace(' (empty = off)', '') ?? key}
                        </dt>
                        <dd className="text-[13px] font-semibold text-primary break-all">{display}</dd>
                    </div>
                );
            })}
    </dl>
);

export const MachineConnectionDetails = ({ machine }: { machine: Machine }) => {
    const { t } = useTranslation();
    const feedbackLabel = (role: string) =>
        ['heater', 'fan', 'drum'].includes(role) ? t(`settings.firescope.feedback.${role}`) : role;
    const fields = buildProtocolRoasterDef(machine.protocol).form_fields;
    const addressFields = addressFormFieldsForProtocol(machine.protocol);
    const registers = machine.protocol === 'modbus' ? record(machine.connectionParams.modbus_registers) : null;
    const channels = machine.protocol === 's7' ? machine.connectionParams.channels : null;
    const sensors: [string, Record<string, unknown>][] = registers
        ? Object.entries(registers).flatMap(([role, value]) => {
              const params = record(value);
              return params ? [[role, params]] : [];
          })
        : Array.isArray(channels)
          ? channels.flatMap((value) => {
                const params = record(value);
                return params && typeof params.role === 'string' ? [[params.role, params]] : [];
            })
          : [];

    return (
        <section
            aria-label={t('machines.connection')}
            className="bg-surface-warm-solid dark:bg-surface-elevated rounded-lg px-4.5 py-4 mb-6"
        >
            <h3 className="text-[12px] font-semibold text-secondary mb-2.5">{t('machines.connection')}</h3>
            <ConnectionFields params={machine.connectionParams} fields={[...fields, ...addressFields]} />
            {sensors.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                    {sensors.map(([role, params]) => (
                        <div key={role} className="min-w-0">
                            <h4 className="text-[12px] font-semibold text-secondary mb-2">{feedbackLabel(role)}</h4>
                            <ConnectionFields
                                params={params}
                                fields={[
                                    ...addressFields,
                                    ...addressFields.flatMap((field) =>
                                        field.key.startsWith('bt_')
                                            ? [
                                                  {
                                                      ...field,
                                                      key: field.key.replace('bt_', `${role.toLowerCase()}_`),
                                                      label: field.label.replace('BT', feedbackLabel(role)),
                                                  },
                                              ]
                                            : [],
                                    ),
                                    {
                                        key: `${role.toLowerCase()}_unit`,
                                        label: t('settings.firescope.sensorUnit'),
                                        type: 'text',
                                        required: false,
                                    },
                                ]}
                                prefix={`${role.toLowerCase()}_`}
                            />
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};
