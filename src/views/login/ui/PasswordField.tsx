import { cn } from '@shared/lib/cn';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface PasswordFieldProps {
    id: string;
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    visible: boolean;
    onToggleVisibility: () => void;
    autoComplete: 'new-password' | 'current-password';
    minLength?: number;
    disabled: boolean;
    labelAction?: ReactNode;
}

export const PasswordField = ({
    id,
    label,
    placeholder,
    value,
    onChange,
    visible,
    onToggleVisibility,
    autoComplete,
    minLength,
    disabled,
    labelAction,
}: PasswordFieldProps) => {
    const { t } = useTranslation();

    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-2">
                <label htmlFor={id} className={cn(labelCls, 'mb-0 text-[13px]')}>
                    {label}
                </label>
                {labelAction}
            </div>
            <div className="relative">
                <input
                    id={id}
                    name={id}
                    type={visible ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    minLength={minLength}
                    required
                    disabled={disabled}
                    className={cn(inputCls, 'h-[42px] pr-11 text-[13px]')}
                />
                <button
                    type="button"
                    onClick={onToggleVisibility}
                    aria-label={t(visible ? 'auth.hidePassword' : 'auth.showPassword')}
                    aria-pressed={visible}
                    aria-controls={id}
                    disabled={disabled}
                    className="absolute inset-y-0 right-1 my-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-strong-border disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {visible ? (
                        <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                        <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
                    )}
                </button>
            </div>
        </div>
    );
};
