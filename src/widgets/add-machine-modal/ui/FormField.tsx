import type { RoasterFormField, SerialPort } from '@entities/machine';
import { ChevronDown } from 'lucide-react';
import { inputCls, labelCls, selectCls } from '../lib/styles';
import { ComportField } from './ComportField';

export const FormField = ({
    field,
    value,
    onChange,
    serialPorts,
    registryDefault,
}: {
    field: RoasterFormField;
    value: string;
    onChange: (v: string) => void;
    serialPorts: SerialPort[];
    registryDefault: string;
}) => (
    <div className={field.key === 'mode' ? 'col-span-2' : ''}>
        <label className={labelCls}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
        </label>
        {field.key === 'comport' ? (
            <ComportField value={value} onChange={onChange} ports={serialPorts} registryDefault={registryDefault} />
        ) : field.options ? (
            <div className="relative">
                <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
                    {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted dark:!text-[#8a8580] pointer-events-none"
                />
            </div>
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
