import { cn } from '@shared/lib/cn';
import { labelCls, loginInputCls } from '@shared/ui/form-styles';
import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';

interface PasswordFieldProps {
    id: string;
    label: string;
    placeholder?: string;
    value: string;
    onChange: (value: string) => void;
    visible: boolean;
    onToggleVisibility: () => void;
    showLabel: string;
    hideLabel: string;
    autoComplete: 'new-password' | 'current-password';
    minLength?: number;
    disabled: boolean;
    invalid?: boolean;
    describedBy?: string;
    hint?: string;
    hintId?: string;
    error?: string | null;
    errorId?: string;
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
    showLabel,
    hideLabel,
    autoComplete,
    minLength,
    disabled,
    invalid = false,
    describedBy,
    hint,
    hintId,
    error,
    errorId,
    labelAction,
}: PasswordFieldProps) => {
    const described = [describedBy, hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(' ');

    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-2">
                <label htmlFor={id} className={cn(labelCls, 'mb-0 text-sm')}>
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
                    aria-invalid={invalid || undefined}
                    aria-describedby={described || undefined}
                    className={cn(loginInputCls, 'h-[42px] pr-11')}
                />
                <button
                    type="button"
                    onClick={onToggleVisibility}
                    aria-label={visible ? hideLabel : showLabel}
                    aria-pressed={visible}
                    aria-controls={id}
                    disabled={disabled}
                    className="absolute inset-y-0 right-1 my-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-surface-elevated focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {visible ? (
                        <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                        <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
                    )}
                </button>
            </div>
            {hint ? (
                <p id={hintId} className="mt-2 text-xs leading-relaxed text-secondary">
                    {hint}
                </p>
            ) : null}
            {error ? (
                <p
                    id={errorId}
                    className="mt-2 rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-xs leading-relaxed text-secondary"
                >
                    {error}
                </p>
            ) : null}
        </div>
    );
};
