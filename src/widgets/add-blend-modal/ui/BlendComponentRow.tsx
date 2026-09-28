import { cn } from '@shared/lib/cn';
import type { Bean } from '@shared/types/database.types';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls } from '@shared/ui/form-styles';
import { X } from 'lucide-react';
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
    // deps re-runs the array refine so errors.components.root tracks bean and ratio edits.

    return (
        <div className="flex gap-2 items-center">
            <FormSelect
                {...register(`components.${index}.bean_id`, { deps: ['components'] })}
                wrapperClassName="min-w-0 flex-1"
            >
                <option value="">{t('beans.blend.modal.selectBean')}</option>
                {beans.map((b) => (
                    <option key={b.id} value={b.id}>
                        {b.name}
                    </option>
                ))}
            </FormSelect>
            <input
                type="number"
                {...register(`components.${index}.ratio_pct`, { valueAsNumber: true, deps: ['components'] })}
                className={cn(inputCls, 'w-20 shrink-0 text-right')}
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
