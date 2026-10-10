import type { NetworkHost, RoasterFormField, SerialPort } from '@entities/machine';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { useId } from 'react';
import { ComportField } from './ComportField';
import { HostField } from './HostField';

export const FormField = ({
    field,
    value,
    onChange,
    serialPorts,
    registryDefault,
    onRefreshPorts,
    networkHosts,
    scanningNetwork,
    scannedNetworkOnce,
    onScanNetwork,
}: {
    field: RoasterFormField;
    value: string;
    onChange: (v: string) => void;
    serialPorts: SerialPort[];
    registryDefault: string;
    onRefreshPorts?: () => void;
    networkHosts?: NetworkHost[];
    scanningNetwork?: boolean;
    scannedNetworkOnce?: boolean;
    onScanNetwork?: () => void;
}) => {
    const inputId = useId();
    return (
        <div className={field.key === 'mode' ? 'col-span-2 min-w-0' : 'min-w-0'}>
            <label htmlFor={inputId} className={labelCls}>
                {field.label}
                {field.required && <span className="text-red-500"> *</span>}
            </label>
            {field.key === 'comport' ? (
                <ComportField
                    id={inputId}
                    value={value}
                    onChange={onChange}
                    ports={serialPorts}
                    registryDefault={registryDefault}
                    onRefresh={onRefreshPorts}
                />
            ) : field.key === 'host' && onScanNetwork ? (
                <HostField
                    id={inputId}
                    value={value}
                    onChange={onChange}
                    hosts={networkHosts ?? []}
                    placeholder={field.placeholder}
                    scanning={scanningNetwork ?? false}
                    onScan={onScanNetwork}
                    scannedOnce={scannedNetworkOnce ?? false}
                />
            ) : field.options ? (
                <FormSelect id={inputId} value={value} onChange={(e) => onChange(e.target.value)}>
                    {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </FormSelect>
            ) : (
                <input
                    id={inputId}
                    className={inputCls}
                    type={field.type === 'number' ? 'number' : 'text'}
                    placeholder={field.placeholder ?? ''}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
};
