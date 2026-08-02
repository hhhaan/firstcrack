import type { RoasterFormField, SerialPort } from '@entities/machine';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ComportField } from './ComportField';

export const FormField = ({
    field,
    value,
    onChange,
    serialPorts,
    registryDefault,
    onRefreshPorts,
}: {
    field: RoasterFormField;
    value: string;
    onChange: (v: string) => void;
    serialPorts: SerialPort[];
    registryDefault: string;
    onRefreshPorts?: () => void;
}) => (
    <div className={field.key === 'mode' ? 'col-span-2' : ''}>
        <label className={labelCls}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
        </label>
        {field.key === 'comport' ? (
            <ComportField
                value={value}
                onChange={onChange}
                ports={serialPorts}
                registryDefault={registryDefault}
                onRefresh={onRefreshPorts}
            />
        ) : field.options ? (
            <FormSelect value={value} onChange={(e) => onChange(e.target.value)}>
                {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </FormSelect>
        ) : (
            <input
                className={inputCls}
                type={field.type === 'number' ? 'number' : 'text'}
                placeholder={field.placeholder ?? ''}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        )}
    </div>
);
