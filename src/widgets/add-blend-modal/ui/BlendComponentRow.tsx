import type { Bean } from '@shared/types/database.types';
import { inputCls } from '@shared/ui/form-styles';
import { ChevronDown, X } from 'lucide-react';
import type { UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { BlendForm } from '../lib/schema';

type BlendComponentRowProps = {
    index: number;
    register: UseFormRegister<BlendForm>;
    beans: Bean[];
    canRemove: boolean;
    onRemove: () => void;
};

export const BlendComponentRow = ({ index, register, beans, canRemove, onRemove }: BlendComponentRowProps) => {
    const { t } = useTranslation();

    return (
        <div className="flex gap-2 items-center">
            <div className="relative flex-1">
                <select
                    {...register(`components.${index}.bean_id`)}
                    className={`${inputCls} appearance-none cursor-pointer`}
                    style={{ paddingRight: '2rem' }}
                >
                    <option value="">{t('beans.blend.modal.selectBean')}</option>
                    {beans.map((b) => (
                        <option key={b.id} value={b.id}>
                            {b.name}
                        </option>
                    ))}
                </select>
                <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
            </div>
            <input
                type="number"
                {...register(`components.${index}.ratio_pct`, { valueAsNumber: true })}
                className={`${inputCls} w-20 text-right`}
                placeholder="%"
                min={1}
                max={100}
            />
            <span className="text-sm text-muted">%</span>
            {canRemove && (
                <button
                    type="button"
                    className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-red-500"
                    onClick={onRemove}
                >
                    <X size={14} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
};
