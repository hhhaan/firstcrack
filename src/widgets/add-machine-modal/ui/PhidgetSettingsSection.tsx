import { isPhidgetRtd, PHIDGET_MODELS, PHIDGET_RTDS, PHIDGET_THERMOCOUPLES } from '@entities/machine';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

type Props = { params: Record<string, string>; setParam: (key: string, value: string) => void };

export const PhidgetSettingsSection = ({ params, setParam }: Props) => {
    const { t } = useTranslation();
    const id = useId();
    const etEnabled = Boolean(params.channel_et?.trim());
    return (
        <section className="space-y-4 md:col-span-full" aria-label={t('addMachine.connectionSettings')}>
            <p className="m-0 text-xs leading-relaxed text-muted">{t('addMachine.phidgetAddressHint')}</p>
            <label className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium text-primary">
                {t('addMachine.phidgetEnableEt')}
                <input
                    type="checkbox"
                    role="switch"
                    checked={etEnabled}
                    aria-checked={etEnabled}
                    onChange={(event) =>
                        setParam(
                            'channel_et',
                            event.target.checked ? (isPhidgetRtd(params.et_device_type) ? '0' : '1') : '',
                        )
                    }
                    className="h-4 w-4 accent-action"
                />
            </label>
            <div className="grid grid-cols-2 gap-4">
                {(['bt', 'et'] as const)
                    .filter((role) => role === 'bt' || etEnabled)
                    .map((role) => {
                        const model = params[`${role}_device_type`];
                        const rtd = isPhidgetRtd(model);
                        const fields = [
                            {
                                key: `${role}_device_type`,
                                label: t('addMachine.phidgetModel'),
                                options: PHIDGET_MODELS.map((value) => ({
                                    value,
                                    label: `${value} (${isPhidgetRtd(value) ? '1× RTD' : '4× TC'})`,
                                })),
                            },
                            {
                                key: `channel_${role}`,
                                label: t('addMachine.phidgetChannel'),
                                options: (rtd ? ['0'] : ['0', '1', '2', '3']).map((value) => ({ value, label: value })),
                            },
                            {
                                key: `${role}_serial_number`,
                                label: t('addMachine.phidgetSerial'),
                                max: 2147483647,
                                min: 1,
                            },
                            ...(model === '1048'
                                ? []
                                : [{ key: `${role}_hub_port`, label: t('addMachine.phidgetHubPort'), max: 5, min: 0 }]),
                            ...(rtd
                                ? [
                                      {
                                          key: `${role}_rtd_type`,
                                          label: t('addMachine.phidgetRtd'),
                                          options: PHIDGET_RTDS.map((value) => ({
                                              value,
                                              label: value
                                                  .replace('_3850', ' (α 0.00385)')
                                                  .replace('_3920', ' (α 0.00392)'),
                                          })),
                                      },
                                      {
                                          key: `${role}_rtd_wire_setup`,
                                          label: t('addMachine.phidgetWires'),
                                          options: ['2', '3', '4'].map((value) => ({ value, label: value })),
                                      },
                                  ]
                                : [
                                      {
                                          key: `${role}_thermocouple_type`,
                                          label: t('addMachine.phidgetThermocouple'),
                                          options: PHIDGET_THERMOCOUPLES.map((value) => ({ value, label: value })),
                                      },
                                  ]),
                        ];
                        return (
                            <fieldset
                                key={role}
                                className="m-0 min-w-0 space-y-3 rounded-xl border border-border bg-surface/40 p-4"
                            >
                                <legend className="px-1 text-sm font-semibold text-primary">
                                    {role.toUpperCase()}
                                </legend>
                                {fields.map((field) => (
                                    <div key={field.key}>
                                        <label htmlFor={`${id}-${field.key}`} className={labelCls}>
                                            {field.label}
                                        </label>
                                        {field.options ? (
                                            <FormSelect
                                                id={`${id}-${field.key}`}
                                                value={params[field.key] ?? ''}
                                                onChange={(event) => setParam(field.key, event.target.value)}
                                            >
                                                {field.options.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </FormSelect>
                                        ) : (
                                            <input
                                                id={`${id}-${field.key}`}
                                                className={inputCls}
                                                type="number"
                                                min={field.min}
                                                max={field.max}
                                                step={1}
                                                value={params[field.key] ?? ''}
                                                placeholder={t('addMachine.phidgetAutomatic')}
                                                onChange={(event) => setParam(field.key, event.target.value)}
                                            />
                                        )}
                                    </div>
                                ))}
                            </fieldset>
                        );
                    })}
            </div>
        </section>
    );
};
