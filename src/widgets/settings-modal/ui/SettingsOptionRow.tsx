import type { InputHTMLAttributes, ReactNode } from 'react';

const rowBase =
    'flex gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21]';
const checkboxCls = 'w-4 h-4 accent-[#111827] dark:accent-[#F2F2F2] shrink-0';
const labelCls = 'text-[14px] font-medium text-[#111827] dark:text-[#e5e5e5]';
const descCls = 'text-[12px] text-[#6B7280] dark:text-[#999] mt-0.5';

type SettingsOptionRowProps = {
    children: ReactNode;
    className?: string;
    /** `label` for clickable checkbox/radio rows */
    as?: 'div' | 'label';
    interactive?: boolean;
    /** trailing control layout */
    justify?: 'start' | 'between';
    align?: 'center' | 'start';
    /** muted fill (info rows) */
    tone?: 'default' | 'muted';
};

export function SettingsOptionRow({
    children,
    className = '',
    as = 'div',
    interactive = false,
    justify = 'start',
    align = 'center',
    tone = 'default',
}: SettingsOptionRowProps) {
    const Comp = as;
    const toneCls = tone === 'muted' ? 'bg-[#F9FAFB] dark:bg-[#262B31]' : '';
    const alignCls = align === 'start' ? 'items-start' : 'items-center';
    const layout = justify === 'between' ? `justify-between ${alignCls}` : alignCls;

    return (
        <Comp className={`${rowBase} ${toneCls} ${layout} ${interactive ? 'cursor-pointer' : ''} ${className}`.trim()}>
            {children}
        </Comp>
    );
}

type SettingsCheckRowProps = {
    type?: 'checkbox' | 'radio';
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
    name?: string;
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'disabled'>;

/** Checkbox / radio option row used across settings sections. */
export function SettingsCheckRow({
    type = 'checkbox',
    checked,
    onChange,
    label,
    description,
    name,
    disabled,
}: SettingsCheckRowProps) {
    return (
        <SettingsOptionRow as="label" interactive align={description ? 'start' : 'center'}>
            <input
                type={type}
                name={name}
                checked={checked}
                disabled={disabled}
                onChange={onChange}
                className={`${checkboxCls} ${description ? 'mt-0.5' : ''}`}
            />
            {description ? (
                <div className="min-w-0">
                    <div className={labelCls}>{label}</div>
                    <div className={descCls}>{description}</div>
                </div>
            ) : (
                <span className={labelCls}>{label}</span>
            )}
        </SettingsOptionRow>
    );
}

export const settingsOptionLabelCls = labelCls;
export const settingsOptionDescCls = descCls;
